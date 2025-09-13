const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://attendance-frontend.onrender.com',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Authentication Routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Check users table
    const userResult = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.user_id, 
        username: user.username, 
        role: user.role 
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.user_id,
        username: user.username,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Student Management Routes
app.get('/api/students/enrolled', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        student_id,
        full_name,
        enrollment_date,
        face_embedding IS NOT NULL as has_face_data,
        section
      FROM students 
      ORDER BY enrollment_date DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching enrolled students:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

app.post('/api/students/enroll', authenticateToken, async (req, res) => {
  try {
    const { studentId, fullName, faceEmbedding, section = 'S33' } = req.body;

    if (!studentId || !fullName || !faceEmbedding) {
      return res.status(400).json({ error: 'Student ID, name, and face embedding required' });
    }

    // Check if student already exists
    const existingStudent = await pool.query(
      'SELECT student_id FROM students WHERE student_id = $1',
      [studentId]
    );

    if (existingStudent.rows.length > 0) {
      return res.status(400).json({ error: 'Student already enrolled' });
    }

    // Insert new student
    const result = await pool.query(`
      INSERT INTO students (student_id, full_name, face_embedding, section, enrollment_date)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING student_id, full_name, enrollment_date
    `, [studentId, fullName, JSON.stringify(faceEmbedding), section]);

    res.json({
      message: 'Student enrolled successfully',
      student: result.rows[0]
    });
  } catch (error) {
    console.error('Error enrolling student:', error);
    res.status(500).json({ error: 'Failed to enroll student' });
  }
});

// Attendance Management Routes
app.post('/api/attendance/save', authenticateToken, async (req, res) => {
  try {
    const {
      sessionData,
      attendanceRecords,
      subject,
      section = 'S33',
      sessionType = 'offline'
    } = req.body;

    if (!sessionData || !attendanceRecords || !subject) {
      return res.status(400).json({ error: 'Session data, attendance records, and subject required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create attendance session
      const sessionResult = await client.query(`
        INSERT INTO attendance_sessions (
          teacher_id, subject, section, session_date, session_type,
          start_time, end_time, total_duration, total_students
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING session_id
      `, [
        req.user.userId,
        subject,
        section,
        new Date().toISOString().split('T')[0],
        sessionType,
        sessionData.startTime,
        sessionData.endTime,
        sessionData.duration,
        attendanceRecords.length
      ]);

      const sessionId = sessionResult.rows[0].session_id;

      // Save attendance records
      for (const record of attendanceRecords) {
        await client.query(`
          INSERT INTO attendance_records (
            session_id, student_id, status, detection_count,
            confidence_score, first_detection_time, last_detection_time
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          sessionId,
          record.studentId,
          record.status,
          record.detectionCount,
          record.confidenceScore,
          record.firstDetectionTime,
          record.lastDetectionTime
        ]);
      }

      await client.query('COMMIT');
      res.json({ 
        message: 'Attendance saved successfully',
        sessionId 
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error saving attendance:', error);
    res.status(500).json({ error: 'Failed to save attendance' });
  }
});

// Analytics Routes
app.get('/api/attendance/analytics', authenticateToken, async (req, res) => {
  try {
    // Get attendance trends
    const trendsResult = await pool.query(`
      SELECT 
        session_date,
        COUNT(*) as total_sessions,
        AVG(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END * 100) as attendance_rate
      FROM attendance_sessions s
      LEFT JOIN attendance_records ar ON s.session_id = ar.session_id
      WHERE s.session_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY session_date
      ORDER BY session_date
    `);

    // Get engagement metrics
    const engagementResult = await pool.query(`
      SELECT 
        s.section,
        AVG(ar.confidence_score) as avg_engagement,
        COUNT(CASE WHEN ar.status = 'present' THEN 1 END) as present_count,
        COUNT(*) as total_count
      FROM attendance_sessions s
      JOIN attendance_records ar ON s.session_id = ar.session_id
      WHERE s.session_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY s.section
    `);

    // Get risk students
    const riskStudentsResult = await pool.query(`
      SELECT 
        st.full_name,
        st.student_id,
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN ar.status = 'present' THEN 1 END) as attended_sessions,
        (COUNT(CASE WHEN ar.status = 'present' THEN 1 END) * 100.0 / COUNT(*)) as attendance_percentage
      FROM students st
      LEFT JOIN attendance_records ar ON st.student_id = ar.student_id
      LEFT JOIN attendance_sessions s ON ar.session_id = s.session_id
      WHERE s.session_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY st.student_id, st.full_name
      HAVING (COUNT(CASE WHEN ar.status = 'present' THEN 1 END) * 100.0 / COUNT(*)) < 75
      ORDER BY attendance_percentage ASC
    `);

    res.json({
      trends: trendsResult.rows,
      engagement: engagementResult.rows,
      riskStudents: riskStudentsResult.rows
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end(() => {
    process.exit(0);
  });
});
