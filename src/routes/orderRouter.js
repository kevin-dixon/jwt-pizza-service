const express = require("express");
const config = require("../config.js");
const metrics = require("../metrics.js");
const logger = require("../logger.js");
const { Role, DB } = require("../database/database.js");
const { authRouter } = require("./authRouter.js");
const { asyncHandler, StatusCodeError } = require("../endpointHelper.js");

const orderRouter = express.Router();

orderRouter.docs = [
  {
    method: "GET",
    path: "/api/order/menu",
    description: "Get the pizza menu",
    example: `curl localhost:3000/api/order/menu`,
    response: [
      {
        id: 1,
        title: "Veggie",
        image: "pizza1.png",
        price: 0.0038,
        description: "A garden of delight",
      },
    ],
  },
  {
    method: "PUT",
    path: "/api/order/menu",
    requiresAuth: true,
    description: "Add an item to the menu",
    example: `curl -X PUT localhost:3000/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Student", "description": "No topping, no sauce, just carbs", "image":"pizza9.png", "price": 0.0001 }'  -H 'Authorization: Bearer tttttt'`,
    response: [
      {
        id: 1,
        title: "Student",
        description: "No topping, no sauce, just carbs",
        image: "pizza9.png",
        price: 0.0001,
      },
    ],
  },
  {
    method: "PUT",
    path: "/api/order/menu/:menuId",
    requiresAuth: true,
    description: "Update a menu item",
    example: `curl -X PUT localhost:3000/api/order/menu/1 -H 'Content-Type: application/json' -d '{ "title":"Veggie Plus", "description": "Still green, now bigger", "image":"pizza1.png", "price": 0.0041 }' -H 'Authorization: Bearer tttttt'`,
    response: {
      id: 1,
      title: "Veggie Plus",
      description: "Still green, now bigger",
      image: "pizza1.png",
      price: 0.0041,
    },
  },
  {
    method: "DELETE",
    path: "/api/order/menu/:menuId",
    requiresAuth: true,
    description: "Delete a menu item",
    example: `curl -X DELETE localhost:3000/api/order/menu/1 -H 'Authorization: Bearer tttttt'`,
    response: { message: "menu item deleted" },
  },
  {
    method: "GET",
    path: "/api/order",
    requiresAuth: true,
    description: "Get the orders for the authenticated user",
    example: `curl -X GET localhost:3000/api/order  -H 'Authorization: Bearer tttttt'`,
    response: {
      dinerId: 4,
      orders: [
        {
          id: 1,
          franchiseId: 1,
          storeId: 1,
          date: "2024-06-05T05:14:40.000Z",
          items: [{ id: 1, menuId: 1, description: "Veggie", price: 0.05 }],
        },
      ],
      page: 1,
    },
  },
  {
    method: "DELETE",
    path: "/api/order",
    requiresAuth: true,
    description: "Delete all orders (admin only)",
    example: `curl -X DELETE localhost:3000/api/order -H 'Authorization: Bearer tttttt'`,
    response: { message: "all orders deleted" },
  },
  {
    method: "POST",
    path: "/api/order",
    requiresAuth: true,
    description: "Create a order for the authenticated user",
    example: `curl -X POST localhost:3000/api/order -H 'Content-Type: application/json' -d '{"franchiseId": 1, "storeId":1, "items":[{ "menuId": 1, "description": "Veggie", "price": 0.05 }]}'  -H 'Authorization: Bearer tttttt'`,
    response: {
      order: {
        franchiseId: 1,
        storeId: 1,
        items: [{ menuId: 1, description: "Veggie", price: 0.05 }],
        id: 1,
      },
      jwt: "1111111111",
    },
  },
];

// getMenu
orderRouter.get(
  "/menu",
  asyncHandler(async (req, res) => {
    res.send(await DB.getMenu());
  }),
);

// addMenuItem
orderRouter.put(
  "/menu",
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError("unable to add menu item", 403);
    }

    const addMenuItemReq = req.body;
    await DB.addMenuItem(addMenuItemReq);
    res.send(await DB.getMenu());
  }),
);

// updateMenuItem
orderRouter.put(
  "/menu/:menuId",
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError("unable to update menu item", 403);
    }

    const menuId = Number(req.params.menuId);
    const updateMenuItemReq = req.body;
    const updatedItem = await DB.updateMenuItem(menuId, updateMenuItemReq);
    res.send(updatedItem);
  }),
);

// deleteMenuItem
orderRouter.delete(
  "/menu/:menuId",
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError("unable to delete menu item", 403);
    }

    const menuId = Number(req.params.menuId);
    await DB.deleteMenuItem(menuId);
    res.send({ message: "menu item deleted" });
  }),
);

// getOrders
orderRouter.get(
  "/",
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(await DB.getOrders(req.user, req.query.page));
  }),
);

// deleteAllOrders
orderRouter.delete(
  "/",
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError("unable to delete orders", 403);
    }

    await DB.deleteAllOrders();
    res.send({ message: "all orders deleted" });
  }),
);

// createOrder
orderRouter.post(
  "/",
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const orderReq = req.body;
    const start = Date.now();
    try {
      const order = await DB.addDinerOrder(req.user, orderReq);
      const factoryReqBody = {
        diner: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
        },
        order,
      };
      logger.log("info", "factory-req", "Sending order to factory", {
        body: JSON.stringify(factoryReqBody),
      });
      const r = await fetch(`${config.factory.url}/api/order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${config.factory.apiKey}`,
        },
        body: JSON.stringify(factoryReqBody),
      });
      const latencyMs = Date.now() - start;
      const j = await r.json();
      logger.log(
        r.ok ? "info" : "warn",
        "factory-res",
        "Received factory response",
        {
          status: r.status,
          body: JSON.stringify(logger.sanitize(j)),
        },
      );
      if (r.ok) {
        const pizzaCount = Array.isArray(orderReq.items)
          ? orderReq.items.length
          : 0;
        const totalPrice = Array.isArray(orderReq.items)
          ? orderReq.items.reduce(
              (total, item) => total + Number(item.price || 0),
              0,
            )
          : 0;
        metrics.pizzaPurchase(true, latencyMs, totalPrice, pizzaCount);
        logger.log("info", "order", "order placed", {
          orderId: order.id,
          userId: req.user.id,
          pizzaCount,
          totalPrice,
          latencyMs,
        });
        res.send({ order, followLinkToEndChaos: j.reportUrl, jwt: j.jwt });
      } else {
        metrics.pizzaPurchase(false, latencyMs, 0, 0);
        logger.log("warn", "order", "order failed at factory", {
          userId: req.user.id,
          status: r.status,
          latencyMs,
        });
        res.status(500).send({
          message: "Failed to fulfill order at factory",
          followLinkToEndChaos: j.reportUrl,
        });
      }
    } catch (error) {
      const latencyMs = Date.now() - start;
      metrics.pizzaPurchase(false, latencyMs, 0, 0);
      logger.log("error", "order", "order exception", {
        userId: req.user.id,
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }),
);

module.exports = orderRouter;
