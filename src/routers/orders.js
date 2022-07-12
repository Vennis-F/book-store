const { auth } = require("../middlewares/auth");
const authorize = require("../middlewares/authorize");
const User = require("../models/user");
const { isValidUpdate } = require("../utils/valid");
const Order = require("../models/order");
const Role = require("../models/role");
const {
  lstOrderPopulateOrderItem,
  orderPopulateOrderItem,
} = require("../utils/order");
const Product = require("../models/product");
const { default: mongoose } = require("mongoose");
const router = require("express").Router();

const getRoleCode = async (name) => {
  return (await Role.findOne({ name })).code;
};

//GET /orders/me (get all orders of user) - me
router.get("/me", auth, authorize("customer"), async (req, res) => {
  try {
    let orders = await Order.find({ owner: req.user._id });

    if (orders.length !== 0) orders = await lstOrderPopulateOrderItem(orders);
    console.log(orders);
    res.send(orders);
  } catch (e) {
    res.status(500).send(e);
  }
});

//GET /orders/me/:id (get order detail by order id) -me
router.get("/me/:id", auth, authorize("customer"), async (req, res) => {
  try {
    let order = await Order.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    //Check order exist
    if (!order) return res.sendStatus(404);

    order = await orderPopulateOrderItem(order);
    res.send(order);
  } catch (e) {
    if (e.name === "CastError" && e.kind === "ObjectId")
      return res.status(400).send({ error: "Invalid ID" });
    res.status(500).send(e);
  }
});

//GET /orders/me/:id (get order detail by order id) -me
router.get("/guest/:id", async (req, res) => {
  try {
    let order = await Order.findOne({
      _id: req.params.id,
    });

    //Check order exist
    if (!order) return res.sendStatus(404);

    order = await orderPopulateOrderItem(order);
    res.send(order);
  } catch (e) {
    if (e.name === "CastError" && e.kind === "ObjectId")
      return res.status(400).send({ error: "Invalid ID" });
    res.status(500).send(e);
  }
});

//PATCH /orders/me/:id
// router.patch("/");

//DELETE /orders/me/:id
//DELETE /cart/empty
router.delete("/me/:id", auth, authorize("customer"), async (req, res) => {
  try {
    let order = await Order.findOne({
      owner: req.user._id,
      _id: req.params.id,
    });

    //Không tìm thấy order
    if (!order) return res.status(404).send({ error: "Order not found!" });

    //Check submitted order
    if (order.status !== "submitted")
      return res
        .status(400)
        .send({ error: "Không thể cancel vì order không ở status submitted" });

    //Trả lại quantity cho products
    await orderPopulateOrderItem(order);
    for (let i = 0; i < order.items.length; i++) {
      const productId = order.items[i].product._id;
      const quantity = order.items[i].quantity;
      const productDBQuantity = order.items[i].product.quantity;

      //Update...
      await Product.findByIdAndUpdate(productId, {
        quantity: quantity + productDBQuantity,
      });
    }

    //Change status to cancel
    order.status = "cancelled";
    await order.save();
    res.status(200).send(order);
  } catch (error) {
    console.log(error);
    res.status(500).send({ error });
  }
});


      //////////////Sale Manager

//GET /orders/saleManager
// Full Order list 
// Pagination: limit, page
// sort: sortedBy = orderDate_desc, customerName_asc, totalCost, status...
// filter: from=...&to=...., saleName, status 
router.get("/saleManager", auth, authorize("saleManager"), async (req, res) => {
  try {
    const { from, to, status,saleName, sortedBy, limit, page } = req.query
    const match={}
    const sort = {}
    const options = { sort }

    //filter
    if (status) {
      let allowedStatus= ["success", "cancelled", "submitted"]
      const isValid = allowedStatus.includes(status)
      if(isValid) {
        match.status= status 
      }
    }

    if(from)
      if(to) {
        match.createdAt={$gte: Date.parse(from), 
          $lt: Date.parse(to)}
      }


    //sort
    if (sortedBy) {
      const parts = sortedBy.split('_') 

      if(parts[0]==='orderDate') {
        sort['createdAt']=(parts[1] === 'desc' ? -1 : 1) 
        options.sort = sort
      } else if(parts[0]==='customerName') {
        sort['receiverName']=(parts[1] === 'desc' ? -1 : 1) 
        options.sort = sort
      } else {
      sort[parts[0]]=(parts[1] === 'desc' ? -1 : 1) 
      options.sort = sort
      }
    }

    //Paging
    if (limit) options.limit = parseInt(limit)
    if (page) options.skip = parseInt(limit) * (parseInt(page) - 1);

    const orders = await Order.find(match,null,options).populate({ path: 'saler'});

    //Saler filter
    if(saleName) {
      const sendOrders=orders.filter((order) => {
        if(order.saler.fullName.match(new RegExp(saleName))) 
          return order
      })
      return res.send({ orders:sendOrders, count: sendOrders.length });
    }

    const count = await Order.countDocuments();
    
    res.send({ orders, count });
  } catch (e) {
    if (e.name === "CastError" && e.kind === "ObjectId")
      return res.status(400).send({ error: "Invalid ID" });
    res.status(500).send(e);
  }
});

//Post /orders/saleManager/search
//search by orderId, customerName     ?orderId=...    customerName=...
//pagination          ?limit=...&page=...
router.post('/saleManager/search', auth, authorize('saleManager'), async (req,res) => {
  try {
    const {limit, page,customerName, orderId} = req.query
    const options={}

    //Paging
    if(limit) options.limit = parseInt(limit)
    if(page) options.skip= parseInt(limit) * (parseInt(page) - 1);
    
    if(customerName) {
      let name= new RegExp(customerName,'gi')
      const order = await Order.find({receiverName: name},null, options)
      return res.send(order)
    }

    if(orderId) {
      const order = await Order.find({_id: new mongoose.Types.ObjectId(orderId)},null, options)
      return res.send(order)
    }

    res.send()
  } catch (error) {
    res.status(500).send(error)
  }
})

//GET /orders/saleManager?orderID=...
router.get("/saleManager", auth, authorize("saleManager"), async (req, res) => {
  try {
    //Find and Check post exist:
    const order = await Order.findById(req.query.orderId);
    await order.populate({path:'owner'})

    for(let i=0; i<order.items.length; i++){
      await order.populate(`items.${i}.product`)
    }

    if (!order) return res.sendStatus(404);

    res.send(order);
  } catch (e) {
    if (e.name === "CastError" && e.kind === "ObjectId")
      return res.status(400).send({ error: "Invalid ID" });
    res.status(500).send(e.message);
  }
});

//GET /orders/saleManager 
//Get a list of active salers
router.get("/saleManager/salers", auth, authorize("saleManager"), async (req, res) => {
    try {
      const salerId = await Role.findOne({name:'saler'})
      console.log(salerId)
      const salers = await User.find({role: salerId._id, status: true})
      res.send(salers)
    } catch (error) {
      res.status(500).send()
    }
})

//PATCH /orders/saleManager/:id
router.patch("/saleManager/:id", auth, authorize("saleManager"), async (req, res) => {
  const updates = Object.keys(req.body);
  const allowUpdateds = [
    "status",
    "saler"     //saler ID
  ];

  if (!isValidUpdate(updates, allowUpdateds))
    return res.status(400).send({ error: "Invalid updates" });

  try {
    const order = await Order.findById(req.params.id)

    if (!order)
      return res.sendStatus(404);

    updates.forEach((update) => {
      order[update] = req.body[update]
    })

    await order.save()

    res.send(order);
  } catch (e) {
    if (e.name === "CastError" && e.kind === "ObjectId")
      return res.status(400).send({ error: "Invalid ID" });
    res.status(400).send(e.message);
  }
});


        ///////////////Saler/////////////////
//GET /orders/saler
// Full Order list 
// Pagination: limit, page
// sort: sortedBy = orderDate_desc, customerName_asc, totalCost, status...
// filter: from=...&to=...., status 
  router.get("/saler", auth, authorize("saler"), async (req, res) => {
    try {
      const { from, to, status, sortedBy, limit, page } = req.query
      const match={saler: req.user._id}
      const sort = {}
      const options = { sort }
  
      //filter
      if (status) {
        let allowedStatus= ["success", "cancelled", "submitted"]
        const isValid = allowedStatus.includes(status)
        if(isValid) {
          match.status= status 
        }
      }
  
      if(from)
        if(to) {
          match.createdAt={$gte: Date.parse(from), 
            $lt: Date.parse(to)}
        }
  
  
      //sort
      if (sortedBy) {
        const parts = sortedBy.split('_') 
  
        if(parts[0]==='orderDate') {
          sort['createdAt']=(parts[1] === 'desc' ? -1 : 1) 
          options.sort = sort
        } else if(parts[0]==='customerName') {
          sort['receiverName']=(parts[1] === 'desc' ? -1 : 1) 
          options.sort = sort
        } else {
        sort[parts[0]]=(parts[1] === 'desc' ? -1 : 1) 
        options.sort = sort
        }
      }
  
      //Paging
      if (limit) options.limit = parseInt(limit)
      if (page) options.skip = parseInt(limit) * (parseInt(page) - 1);
  
      const orders = await Order.find(match,null,options);
  
      const count = orders.length
      
      res.send({ orders, count });
    } catch (e) {
      if (e.name === "CastError" && e.kind === "ObjectId")
        return res.status(400).send({ error: "Invalid ID" });
      res.status(500).send(e);
    }
  });
  
  //Post /orders/saler/search
  //search by orderId, customerName     ?orderId=...    customerName=...
  //pagination          ?limit=...&page=...
  router.post('/saler/search', auth, authorize('saler'), async (req,res) => {
    try {
      const {limit, page,customerName, orderId} = req.query
      const options={}
  
      //Paging
      if(limit) options.limit = parseInt(limit)
      if(page) options.skip= parseInt(limit) * (parseInt(page) - 1);
      
      if(customerName) {
        let name= new RegExp(customerName,'gi')
        const order = await Order.find({receiverName: name, saler: req.user._id},null, options)
        return res.send(order)
      }
  
      if(orderId) {
        const order = await Order.find({_id: new mongoose.Types.ObjectId(orderId), saler: req.user._id},null, options)
        return res.send(order)
      }
  
      res.send()
    } catch (error) {
      res.status(500).send(error)
    }
  })

//GET /orders/saler/:id
router.get("/saler/:id", auth, authorize("saler"), async (req, res) => {
  try {
    //Find and Check post exist:
    const order = await Order.findOne({_id:new mongoose.Types.ObjectId(req.params.id), saler: req.user._id});
    if (!order) return res.sendStatus(404);

    await order.populate({path:'owner'})

    for(let i=0; i<order.items.length; i++){
      await order.populate(`items.${i}.product`)
    }


    res.send(order);
  } catch (e) {
    if (e.name === "CastError" && e.kind === "ObjectId")
      return res.status(400).send({ error: "Invalid ID" });
    res.status(500).send(e.message);
  }
});

//PATCH /orders/saler/:id
router.patch("/saler/:id", auth, authorize("saler"), async (req, res) => {
  const updates = Object.keys(req.body);
  const allowUpdateds = [
    "status"
  ];

  if (!isValidUpdate(updates, allowUpdateds))
    return res.status(400).send({ error: "Invalid updates" });

  try {
    const order = await Order.findOneAndUpdate({_id:new mongoose.Types.ObjectId(req.params.id), saler: req.user._id}, req.body)

    if (!order)
      return res.sendStatus(404);

    await order.save()

    res.send(order);
  } catch (e) {
    if (e.name === "CastError" && e.kind === "ObjectId")
      return res.status(400).send({ error: "Invalid ID" });
    res.status(400).send(e.message);
  }
});

module.exports = router;
