const express = require('express');
const path = require('path');
const pool = require('./database/pool'); // Imports your native mariadb pool
const session = require('express-session'); // Added express-session
const bcrypt = require('bcrypt'); // Make sure this is at the top of server.js if it isn't already

require('dotenv').config();

const app = express();
app.use(express.json());
app.locals.db = pool;

// --- SESSION CONFIGURATION ---
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 600 * 60 * 1000, // Session auto-expires after 600 minutes of inactivity
        secure: false,          // Set to true if your server uses HTTPS/SSL in production
        httpOnly: true          // Helps protect against Cross-Site Scripting (XSS) attacks
    }
}));

app.use(express.static('views'));
app.use('/css', express.static(path.join(__dirname, 'css')));



// --- AUTH MIDDLEWARE ---


// Protects standard management routes
const adminAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.status(401).json({ error: 'Authentication required. Session expired.' });
};

// NEW: Protects multi-timezone management routes
const multiAdminAuth = (req, res, next) => {
    if (req.session && (req.session.isMultiAdmin || req.session.memberId)) {
        return next();
    }
    res.status(401).json({ error: 'Authentication required. Session expired.' });
};


// ── 2. NEW MEMBER AUTHENTICATION MIDDLEWARE (Uses database records) ────────
const memberAuth = (req, res, next) => {
    if (req.session && req.session.memberId) {
        return next();
    }
    res.status(401).json({ error: 'Portal authentication required.' });
};

// ── OWNER MEMBER AUTHENTICATION (Members with owner type only) ────────────
const ownerMemberAuth = (req, res, next) => {
    if (req.session && req.session.memberId && req.session.memberType === 'owner') {
        return next();
    }
    res.status(401).json({ error: 'Owner access required.' });
};


// ── ADD THIS: MOUNT THE MEMBERS ROUTER WITH AUTH MIDDLEWARE ────────────────
const membersRouter = require('./routes/members');
app.use('/api/admin/members', adminAuth, membersRouter);

// ... [Keep your existing authentication endpoints and standard booking APIs] ...

// ── ADD THIS: ROUTE TO SERVE THE HTML INTERFACE ────────────────────────────
// Protects your frontend management view to authorized administrators only
app.get('/admin/members', (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.sendFile(path.join(__dirname, 'views/members.html')); 
    }
    res.redirect('/login');
});


// --- AUTHENTICATION API ENDPOINTS ---

// Standard Login endpoint
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true; // Store authenticated status inside the session
        return res.json({ success: true, message: 'Logged in successfully' });
    }
    
    res.status(401).json({ error: 'Invalid credentials' });
});


// ── 3. MEMBER LOGIN ENDPOINT ──────────────────────────────────────────────
app.post('/api/auth/member-login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        // Query database table natively using the mariadb pool
        const rows = await pool.query(
            'SELECT member_id, display_name, username, password_hash, is_active, type_id FROM project_members WHERE username = ?',
            [username.trim()]
        );
        const member = rows[0];

        if (!member || !member.password_hash) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        if (!member.is_active) {
            return res.status(403).json({ error: 'This portal account is currently inactive.' });
        }

        // Compare using bcrypt
        const match = await bcrypt.compare(password, member.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        // Write specific session properties completely separate from the root admin block
        req.session.memberId = member.member_id.toString(); // stringified BigInt
        req.session.memberDisplayName = member.display_name;
        req.session.memberType = member.type_id === 4 ? 'owner' : 'member'; // type_id 4 = owner

        res.json({ success: true, displayName: member.display_name });
    } catch (err) {
        console.error('[Member login error]', err);
        res.status(500).json({ error: 'Database authentication error.' });
    }
});

// NEW: Multi-timezone Login endpoint
app.post('/api/multi-admin/login', (req, res) => {
    const { username, password } = req.body;
    console.log('Multi-admin login attempt:', username);
    if (username === process.env.MULTI_ADMIN_USERNAME && password === process.env.MULTI_ADMIN_PASSWORD) {
        req.session.isMultiAdmin = true; // Store multi-admin authenticated status inside the session
        return res.json({ success: true, message: 'Logged in successfully' });
    }
    
    res.status(401).json({ error: 'Invalid credentials' });
});

// Explicit Logout endpoint (Clears both session flags)
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Could not log out');
        }
        res.clearCookie('connect.sid'); // Clears the session identifier cookie from browser
        res.sendStatus(200);
    });
});

// --- VIP PUBLIC API ---

// Fetch available slots
app.get('/api/available-slots', async (req, res) => {
    try {
        const rows = await pool.query(
            "SELECT slot_id, start_time , slot_category FROM booking_slots WHERE is_available = TRUE AND is_special_slot = TRUE AND start_time >= NOW()"
        );

        const formatted = rows.map(r => ({
            id: r.slot_id,
            title:  (r.slot_category ? `${r.slot_category} ` : '') + '- Available',
            // MUST MATCH: replace space with T and add Z
            start: r.start_time.replace(" ", "T") + "Z" 
        }));
        
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// Book a slot
// app.post('/api/book', async (req, res) => {
//     const { slotId, userName } = req.body;
//     try {
//         const result = await pool.query(
//             `UPDATE booking_slots 
//              SET booked_by_id = 'WEB_VIP', booked_by_name = ?, is_available = FALSE 
//              WHERE slot_id = ? AND is_available = TRUE AND is_special_slot = TRUE`, 
//             [userName, slotId]
//         );
        
//         result.affectedRows > 0 ? res.sendStatus(200) : res.status(400).send("Slot already taken");
//     } catch (err) {
//         console.error(err);
//         res.status(500).send("Database error");
//     }
// });

// app.post('/api/book', async (req, res) => {
//     const { slotId, userName } = req.body;
//     try {
//         // Fetch the slot category first
//         const rows = await pool.query(
//             `SELECT slot_category FROM booking_slots WHERE slot_id = ?`,
//             [slotId]
//         );

//         if (rows.length === 0) {
//             return res.status(400).send("Slot not found");
//         }

//         const isStaffOrCollaborator = ['staff', 'collaborator'].includes(rows[0].slot_category);

//         let result;

//         if (isStaffOrCollaborator) {
//             result = await pool.query(
//                 `UPDATE booking_slots 
//                  SET booked_by_id = 'WEB_VIP', booked_by_name = ?, is_available = FALSE 
//                  WHERE slot_id = ? AND is_available = TRUE AND is_special_slot = TRUE`,
//                 [userName, slotId]
//             );
//         } else {
//             result = await pool.query(
//                 `UPDATE booking_slots 
//                  SET booked_by_id = 'WEB_VIP', booked_by_name = ?, is_available = FALSE 
//                  WHERE slot_id = ? AND is_available = TRUE AND is_special_slot = FALSE`,
//                 [userName, slotId]
//             );
//         }

//         result.affectedRows > 0 ? res.sendStatus(200) : res.status(400).send("Slot already taken");
//     } catch (err) {
//         console.error(err);
//         res.status(500).send("Database error");
//     }
// });

app.post('/api/book', async (req, res) => {
    const { slotId, userName, userId } = req.body; // Extract real Discord Snowflake ID passed from frontend
    
    // Default to backup values if not provided by form variables
    const finalUserId = userId || 'WEB_VIP';
    const finalUserName = userName || 'Unknown Student';

    try {
        // Fetch the slot category first
        const rows = await pool.query(
            `SELECT slot_category FROM booking_slots WHERE slot_id = ?`,
            [slotId]
        );

        if (rows.length === 0) {
            return res.status(400).send("Slot not found");
        }

        const isStaffOrCollaborator = ['staff', 'collaborator'].includes(rows[0].slot_category);
        let result;

        if (isStaffOrCollaborator) {
            result = await pool.query(
                `UPDATE booking_slots 
                 SET booked_by_id = ?, booked_by_name = ?, is_available = FALSE 
                 WHERE slot_id = ? AND is_available = TRUE AND is_special_slot = TRUE`,
                [finalUserId, finalUserName, slotId]
            );
        } else {
            result = await pool.query(
                `UPDATE booking_slots 
                 SET booked_by_id = ?, booked_by_name = ?, is_available = FALSE 
                 WHERE slot_id = ? AND is_available = TRUE AND is_special_slot = FALSE`,
                [finalUserId, finalUserName, slotId]
            );
        }

        result.affectedRows > 0 ? res.sendStatus(200) : res.status(400).send("Slot already taken");
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// --- MANAGEMENT PRIVATE API ---

// Standard Admin Bookings (Open)
app.get('/api/admin/bookings', async (req, res) => {
    try {
        const rows = await pool.query("SELECT * FROM booking_slots ORDER BY start_time ASC");
        
        const formattedData = rows.map(row => {
            let title = 'Available';
            if (row.is_no_show) {
                title = `🚩 ${row.booked_by_name || 'No Show'}`;
            } else if (!row.is_available) {
                title = row.booked_by_name || 'Booked';
            }

            return {
                id: row.slot_id,
                title: title , 
                start: row.start_time.replace(" ", "T") + "Z" ,
                is_available: row.is_available,
                is_no_show: row.is_no_show,
                slot_category: row.slot_category
            };
        });

        res.json(formattedData);
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// NEW: Multi-Admin Bookings API Endpoint
app.get('/api/multi-admin/bookings', multiAdminAuth, async (req, res) => {
    try {
        const rows = await pool.query("SELECT * FROM booking_slots ORDER BY start_time ASC");
        
        const formattedData = rows.map(row => {
            let title = 'Available';
            if (row.is_no_show) {
                title = `🚩 ${row.booked_by_name || 'No Show'}`;
            } else if (!row.is_available) {
                title = row.booked_by_name || 'Not Available';
            }

            return {
                id: row.slot_id,
                title: title , 
                start: row.start_time.replace(" ", "T") + "Z" ,
                is_available: row.is_available,
                is_no_show: row.is_no_show,
                slot_category: row.slot_category
            };
        });

        res.json(formattedData);
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});


// --- SERVE PAGES ---

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));

// Booking Calendar Page
app.get('/booking', (req, res) => res.sendFile(path.join(__dirname, 'views/calendar.html')));

// Standard Login Page
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login/login.html')));

// Project Login Page
app.get('/project-login', (req, res) => res.sendFile(path.join(__dirname, 'views/login/project_login.html')));

// NEW: Multi Login Page
app.get('/multi-login', (req, res) => res.sendFile(path.join(__dirname, 'views/login/multi-login.html')));

// Protected Standard Management Page (Owner Members Only)
app.get('/manage', (req, res) => {
    if (req.session && req.session.memberId && req.session.memberType === 'owner') {
        return res.sendFile(path.join(__dirname, 'views/management.html'));
    }
    res.redirect('/project-login');
});

// NEW: Multi-Management Page
app.get('/multi', (req, res) => {
    // if (req.session && req.session.isMultiAdmin) {
    if (req.session && req.session.memberId) {
        return res.sendFile(path.join(__dirname, 'views/calendarMultiTimezone.html'));
    }
    res.redirect('/multi-login');
});


// Toggle No Show status from the standard dashboard (Open)
app.post('/api/admin/noshow/:id', async (req, res) => {
    try {
        await pool.query(
            "UPDATE booking_slots SET is_no_show = TRUE WHERE slot_id = ?",
            [req.params.id]
        );
        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to update status");
    }
});

// NEW: Cancel and Reset booking slot from standard dashboard (Open)
app.post('/api/admin/cancel/:id', async (req, res) => {
    try {
        await pool.query(
            `UPDATE booking_slots 
             SET booked_by_id = NULL, booked_by_name = NULL, is_available = TRUE, is_no_show = FALSE 
             WHERE slot_id = ?`,
            [req.params.id]
        );
        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to cancel booking");
    }
});

// NEW: Toggle No Show status from the multi dashboard
app.post('/api/multi-admin/noshow/:id', multiAdminAuth, async (req, res) => {
    try {
        await pool.query(
            "UPDATE booking_slots SET is_no_show = TRUE WHERE slot_id = ?",
            [req.params.id]
        );
        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to update status");
    }
});

// NEW: Cancel and Reset booking slot from multi dashboard
app.post('/api/multi-admin/cancel/:id', multiAdminAuth, async (req, res) => {
    try {
        await pool.query(
            `UPDATE booking_slots 
             SET booked_by_id = NULL, booked_by_name = NULL, is_available = TRUE, is_no_show = FALSE 
             WHERE slot_id = ?`,
            [req.params.id]
        );
        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to cancel booking");
    }
});

// --- GET CURRENT USER PROFILE ---
app.get('/api/todo/me', memberAuth, (req, res) => {
    if (req.session.memberId && req.session.memberDisplayName) {
        return res.json({
            member_id: parseInt(req.session.memberId),
            display_name: req.session.memberDisplayName
        });
    }
    res.status(401).json({ error: 'User session not found.' });
});

// --- TODO TASK API (protected by memberAuth) ---

// GET all active tasks with joined names for the logged-in member
app.get('/api/todo/tasks', memberAuth, async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT 
                pt.task_id, pt.title, pt.description,
                pt.priority_id, pt.status_id,
                pt.due_date, pt.created_at, pt.updated_at,
                pt.project_id,
                pm.display_name AS assignee_name,
                pm.member_id    AS assignee_id,
                p.project_name
            FROM project_tasks pt
            LEFT JOIN project_members pm ON pt.assignee_id = pm.member_id
            LEFT JOIN projects p         ON pt.project_id  = p.project_id
            WHERE pt.is_deleted = FALSE AND pt.assignee_id = ?
            ORDER BY pt.priority_id ASC, pt.created_at DESC
        `, [req.session.memberId]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET active projects (for project dropdown)
app.get('/api/todo/projects', memberAuth, async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT project_id, project_name
            FROM projects
            ORDER BY project_name ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST create a new task
app.post('/api/todo/tasks', memberAuth, async (req, res) => {
    const { title, description, priorityId, statusId, projectId, dueDate } = req.body;
    if (!title) {
        return res.status(400).send('Title is required');
    }
    const assigneeId = req.session.memberId;
    if (!assigneeId) {
        return res.status(401).send('Session expired or invalid assignee');
    }
    try {
        await pool.query(
            `INSERT INTO project_tasks (title, description, priority_id, status_id, assignee_id, project_id, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [title, description || null, priorityId || 2, statusId || 1, assigneeId, projectId || null, dueDate || null]
        );
        res.sendStatus(201);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});

// PATCH update task status (restricted to assignee)
app.patch('/api/todo/tasks/:id/status', memberAuth, async (req, res) => {
    const { statusId } = req.body;
    if (!statusId) {
        return res.status(400).send('statusId is required');
    }
    try {
        const result = await pool.query(
            `UPDATE project_tasks
             SET status_id = ?, updated_at = NOW()
             WHERE task_id = ? AND assignee_id = ? AND is_deleted = FALSE`,
            [statusId, req.params.id, req.session.memberId]
        );
        if (result.affectedRows > 0) {
            res.sendStatus(200);
        } else {
            res.status(404).send('Task not found or unauthorized');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});


// --- DISCORD USER PROFILE SEARCH PROXY ---
app.get('/api/discord-lookup', async (req, res) => {
    const targetName = req.query.name;
    if (!targetName) return res.status(400).send("Name parameter missing.");

    try {
        // Point this to your standalone discord bot's port (e.g., Port 3001)
        const botPort = process.env.DISCORD_BOT_PORT || 3005;
        const botResponse = await fetch(`http://localhost:${botPort}/api/user-by-username?name=${encodeURIComponent(targetName)}`);
        
        if (botResponse.status === 404) {
            return res.status(404).send("User not found in the Discord server.");
        }
        
        if (!botResponse.ok) {
            return res.status(500).send("Error response from internal Discord bot.");
        }

        const data = await botResponse.json();
        res.json(data); // Pass data directly back to frontend layout
    } catch (err) {
        console.error(err);
        res.status(500).send("Could not connect to Discord bot endpoint.");
    }
});

// Start Server
const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`🚀 Portal running on http://localhost:${PORT}`));