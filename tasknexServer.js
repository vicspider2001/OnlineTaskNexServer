const express = require('express');
const TaskNexApp = express();
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors')
const bodyparser = require('body-parser');
const jwt = require('jsonwebtoken');

// --- NEW IMPORTS FOR CLOUDINARY ---
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

dotenv.config();
const MongoOnline = process.env.MongoOnline;
const port = process.env.PORT || 1111;
let db;

// --- CLOUDINARY CONFIGURATION ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET 
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'farm_inventory', 
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    },
  });

const upload = multer({ storage: storage });

TaskNexApp.use(bodyparser.urlencoded({extended:true}));
TaskNexApp.use(bodyparser.json());
TaskNexApp.use(cors());



TaskNexApp.get('/',(req,res)=>{
    res.send("Welcome to Oak Ranch Farm")
})

// --- ROUTES ---

// 1. GET ALL PRODUCE
TaskNexApp.get('/api/produce', async (req, res) => {
    try {
        const result = await db.collection('produce').find().toArray();
        res.status(200).json(result);
    } catch (err) {
        res.status(500).send("Error fetching harvest data");
    }
});

// 2. GET SINGLE PRODUCT BY ID
TaskNexApp.get('/api/produce/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID format");

        const result = await db.collection('produce').findOne({ _id: new ObjectId(id) });
        if (!result) return res.status(404).send("Product not found");
        res.status(200).json(result);
    } catch (err) {
        res.status(500).send("Error fetching product details");
    }
});

// 3. GET TRACEABILITY DATA
TaskNexApp.get('/api/trace/:id', async (req, res) => {
    try {
        const serial = req.params.id;
        const batch = await db.collection('batches').findOne({ serialNumber: serial });
        if (!batch) return res.status(404).json({ message: "Serial number not found." });
        res.json(batch);
    } catch (err) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});


// 4. POST A NEW RESERVATION
TaskNexApp.post('/api/reserve', async (req, res) => {
    try {
        const { customerName, phone, pickupDate, pickupSlot, items, totalAmount } = req.body;

        // 1. Prepare the reservation object
        const newReservation = {
            customerName,
            phone,
            pickupDate,
            pickupSlot,
            items: items.map(item => ({
                productId: new ObjectId(item._id),
                name: item.name,
                quantity: item.quantity,
                priceAtReservation: item.price
            })),
            totalAmount,
            status: 'Pending',
            createdAt: new Date()
        };

        // 2. Decrement stock for each item in the 'produce' collection
        // We use bulkWrite for efficiency
        const stockUpdates = items.map(item => ({
            updateOne: {
                filter: { _id: new ObjectId(item._id) },
                update: { $inc: { stockQuantity: -item.quantity } }
            }
        }));

        // Execute stock updates and insert reservation
        await db.collection('produce').bulkWrite(stockUpdates);
        const result = await db.collection('reservations').insertOne(newReservation);

        res.status(201).json({ 
            message: "Harvest secured successfully", 
            reservationId: result.insertedId 
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error securing your reservation");
    }
});

// 1. LOGIN ROUTE
TaskNexApp.post('/api/neary/login', (req, res) => {
    const { password } = req.body;
    
    if (password === process.env.ADMIN_PASSWORD) {
        // Issue a token that lasts 24 hours
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, token });
    }
    
    res.status(401).json({ success: false, message: "Incorrect Barn Key" });
});

// 2. MIDDLEWARE TO PROTECT ROUTES
const protect = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>
    if (!token) return res.status(403).send("Access Denied");

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).send("Invalid Token");
    }
};

// 5. GET ALL RESERVATIONS (For the Admin Dashboard)
TaskNexApp.get('/api/reservations/all', protect, async (req, res) => {
    try {
        // Sorting by pickupDate (ascending) to see the soonest ones first
        const result = await db.collection('reservations')
            .find()
            .sort({ pickupDate: 1 })
            .toArray();
        res.status(200).json(result);
    } catch (err) {
        res.status(500).send("Error fetching registry");
    }
});

// GET ALL MESSAGES (Admin Only)
TaskNexApp.get('/api/messages/all', protect, async (req, res) => {
    try {
        const result = await db.collection('messages')
            .find()
            .sort({ receivedAt: -1 }) // Newest first
            .toArray();
        res.status(200).json(result);
    } catch (err) {
        res.status(500).send("Error fetching messages");
    }
});

// GET LOW STOCK ITEMS (Admin Only)
TaskNexApp.get('/api/inventory/low-stock', protect, async (req, res) => {
    try {
        const threshold = 10; // You can change this number
        const lowStockItems = await db.collection('produce')
            .find({ stockQuantity: { $lt: threshold } })
            .toArray();
        res.status(200).json(lowStockItems);
    } catch (err) {
        res.status(500).send("Error fetching inventory levels");
    }
});

// UPDATE STOCK QUANTITY
TaskNexApp.patch('/api/inventory/:id/stock', protect, async (req, res) => {
    try {
        const { id } = req.params;
        const { newQuantity } = req.body;
        
        await db.collection('produce').updateOne(
            { _id: new ObjectId(id) },
            { $set: { stockQuantity: parseInt(newQuantity) } }
        );
        res.status(200).send("Stock updated");
    } catch (err) {
        res.status(500).send("Error updating stock");
    }
});

// 6. UPDATE RESERVATION STATUS (To mark as 'Picked Up')
TaskNexApp.patch('/api/reservations/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body; // e.g., "Picked Up" or "Cancelled"
        
        await db.collection('reservations').updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: status } }
        );
        res.status(200).send("Status updated");
    } catch (err) {
        res.status(500).send("Error updating status");
    }
});

TaskNexApp.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const newMessage = {
            name,
            email,
            message,
            receivedAt: new Date(),
            read: false
        };
        
        await db.collection('messages').insertOne(newMessage);
        res.status(201).send("Message recorded");
    } catch (err) {
        res.status(500).send("Server Error");
    }
});

// 1. GET ALL CATEGORIES
TaskNexApp.get('/api/categories', async (req, res) => {
    try {
        const categories = await db.collection('categories').find().toArray();
        res.status(200).json(categories);
    } catch (err) {
        res.status(500).send("Error fetching categories");
    }
});

// 2. ADD NEW CATEGORY (Admin Only)
TaskNexApp.post('/api/categories/add', protect, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).send("Category name is required");
        
        const result = await db.collection('categories').insertOne({ 
            name, 
            createdAt: new Date() 
        });
        res.status(201).json(result);
    } catch (err) {
        res.status(500).send("Error adding category");
    }
});

TaskNexApp.delete('/api/categories/:id', protect, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('categories').deleteOne({ _id: new ObjectId(id) });
        res.status(200).send("Category removed");
    } catch (err) {
        res.status(500).send("Error deleting category");
    }
});

// NEW HARVEST ROUTE (IMPLEMENTED HERE)
TaskNexApp.post('/api/inventory/add', protect, upload.single('image'), async (req, res) => {
    try {
        const { name, category, stockQuantity, price } = req.body;
        const newProduce = {
            name,
            category,
            stockQuantity: parseInt(stockQuantity),
            price: parseFloat(price) || 0, // Helpful to have price for new items
            image: req.file ? req.file.path : null, 
            createdAt: new Date()
        };
        const result = await db.collection('produce').insertOne(newProduce);
        res.status(201).json({ message: "Harvest recorded successfully!", id: result.insertedId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to process harvest." });
    }
});

// DELETE HARVEST & CLOUDINARY IMAGE
TaskNexApp.delete('/api/inventory/:id', protect, async (req, res) => {
    try {
        const { id } = req.params;
        const item = await db.collection('inventory').findOne({ _id: new ObjectId(id) });

        if (!item) {
            return res.status(404).json({ message: "Harvest not found" });
        }

        // 1. Delete from Cloudinary using the public_id
        // (Ensure you stored 'public_id' in your DB during the upload)
        if (item.cloudinaryId) {
            await cloudinary.uploader.destroy(item.cloudinaryId);
        }

        // 2. Delete from MongoDB
        await db.collection('inventory').deleteOne({ _id: new ObjectId(id) });

        res.status(200).json({ message: "Harvest and Cloudinary image purged." });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error during deletion process.");
    }
});


MongoClient.connect(MongoOnline, (err, client) => {
    if(err) console.log("error while connecting");
    db = client.db('tasknexdb');
    TaskNexApp.listen(port, '0.0.0.0',()=>{
        console.log(`listening on port ${port}`)
    })
})
