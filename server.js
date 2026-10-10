const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads')); // Serve uploaded files statically

// Multer Storage Configuration for Images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Create MySQL Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Test Database Connection
db.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed:', err);
    } else {
        console.log('Connected to MySQL Database successfully!');
        connection.release();
    }
});

// --- API ROUTES ---

// 1. Submit Waste Report with Image Upload
app.post('/api/reports', upload.single('waste_image'), (req, res) => {
    const { user_name, location, waste_type, description } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const query = 'INSERT INTO reports (user_name, location, waste_type, description, image_url) VALUES (?, ?, ?, ?, ?)';
    
    db.query(query, [user_name, location, waste_type, description, imageUrl], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, message: 'Report submitted successfully!', reportId: result.insertId });
    });
});

// 2. Get All Waste Reports
app.get('/api/reports', (req, res) => {
    db.query('SELECT * FROM reports ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. Schedule a Pickup
app.post('/api/pickups', (req, res) => {
    const { resident_name, address, phone, waste_category, preferred_date } = req.body;
    const query = 'INSERT INTO pickups (resident_name, address, phone, waste_category, preferred_date) VALUES (?, ?, ?, ?, ?)';
    
    db.query(query, [resident_name, address, phone, waste_category, preferred_date], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, message: 'Pickup scheduled successfully!', pickupId: result.insertId });
    });
});

// --- DYNAMIC COMMUNITY APIS ---

// 1. Get Live Impact Statistics & Leaderboard
app.get('/api/community/stats', (req, res) => {
    const statsQuery = `
        SELECT 
            (SELECT COUNT(*) FROM reports) AS total_reports,
            (SELECT COUNT(*) FROM reports WHERE status = 'Resolved') AS resolved_reports,
            (SELECT COUNT(*) FROM pickups) AS total_pickups,
            (SELECT COALESCE(SUM(eco_points), 0) FROM societies) AS total_points
    `;
    
    db.query(statsQuery, (err, statsResult) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query('SELECT * FROM societies ORDER BY eco_points DESC', (err, leaderboardResult) => {
            if (err) return res.status(500).json({ error: err.message });
            
            res.json({
                stats: statsResult[0],
                leaderboard: leaderboardResult
            });
        });
    });
});

// 2. Post a New Community Event
app.post('/api/events', (req, res) => {
    const { title, location, event_date, bonus_points } = req.body;
    const query = 'INSERT INTO community_events (title, location, event_date, bonus_points) VALUES (?, ?, ?, ?)';
    
    db.query(query, [title, location, event_date, bonus_points || 50], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, message: 'Community drive published successfully!' });
    });
});

// 3. Get All Community Events
app.get('/api/events', (req, res) => {
    db.query('SELECT * FROM community_events ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 4. Update Report Status (Resolve Issue & Add Eco-Points to Leaderboard)
app.put('/api/reports/:id/resolve', (req, res) => {
    const reportId = req.params.id;

    // First get the location/society name from the report
    db.query('SELECT location FROM reports WHERE id = ?', [reportId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ success: false, message: 'Report not found' });
        
        const societyName = results[0].location;

        // Update report status to Resolved
        db.query('UPDATE reports SET status = ? WHERE id = ?', ['Resolved', reportId], (updateErr) => {
            if (updateErr) return res.status(500).json({ success: false, message: 'Database error' });

            // Check if society already exists in the societies table, if not insert it, then add points/resolved count
            const upsertQuery = `
                INSERT INTO societies (society_name, reports_resolved, eco_points) 
                VALUES (?, 1, 100) 
                ON DUPLICATE KEY UPDATE 
                reports_resolved = reports_resolved + 1, 
                eco_points = eco_points + 100;
            `;

            db.query(upsertQuery, [societyName], (pointErr) => {
                if (pointErr) console.error(pointErr);
                res.json({ success: true, message: 'Report marked as resolved and points added to leaderboard!' });
            });
        });
    });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running smoothly on http://localhost:${PORT}`);
});