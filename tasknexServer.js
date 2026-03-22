const express = require('express');
const TaskNexApp = express();
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors')
const bodyparser = require('body-parser');

dotenv.config();
const MongoOnline = process.env.MongoOnline;
const port = process.env.PORT || 1111;
let db;



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


MongoClient.connect(MongoOnline, (err, client) => {
    if(err) console.log("error while connecting");
    db = client.db('tasknexdb');
    TaskNexApp.listen(port, '0.0.0.0',()=>{
        console.log(`listening on port ${port}`)
    })
})
