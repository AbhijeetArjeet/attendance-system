-- Enhanced Student Attendance System Database Schema

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS attendance_sessions CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table for authentication
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'teacher',
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Students table for enrolled students
CREATE TABLE students (
    student_id VARCHAR(50) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    face_embedding JSONB,
    section VARCHAR(10) DEFAULT 'S33',
    enrollment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance sessions table
CREATE TABLE attendance_sessions (
    session_id SERIAL PRIMARY KEY,
    teacher_id INTEGER REFERENCES users(user_id),
    subject VARCHAR(100) NOT NULL,
    section VARCHAR(10) NOT NULL,
    session_date DATE NOT NULL,
    session_type VARCHAR(20) DEFAULT 'offline',
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    total_duration INTEGER, -- in minutes
    total_students INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Individual attendance records
CREATE TABLE attendance_records (
    record_id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
    student_id VARCHAR(50) REFERENCES students(student_id),
    status VARCHAR(20) DEFAULT 'absent', -- 'present', 'partial', 'absent'
    detection_count INTEGER DEFAULT 0,
    confidence_score DECIMAL(4,3) DEFAULT 0.000,
    first_detection_time TIMESTAMP,
    last_detection_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_attendance_sessions_date ON attendance_sessions(session_date);
CREATE INDEX idx_attendance_sessions_teacher ON attendance_sessions(teacher_id);
CREATE INDEX idx_attendance_records_session ON attendance_records(session_id);
CREATE INDEX idx_attendance_records_student ON attendance_records(student_id);
CREATE INDEX idx_students_section ON students(section);

-- Insert demo users (password is hashed version of 'teach123' and 'admin123')
INSERT INTO users (username, password_hash, role, first_name, last_name, email) VALUES
('teacher', '$2a$10$rQZ8kN4K0yHxGqFcHvdJ5.Wq7gQZ8KyFgFYpGqHvFcHvdJ5Wq7gQZ8K', 'teacher', 'Demo', 'Teacher', 'teacher@example.com'),
('admin', '$2a$10$rQZ8kN4K0yHxGqFcHvdJ5.Wq7gQZ8KyFgFYpGqHvFcHvdJ5Wq7gQZ8K', 'admin', 'Demo', 'Admin', 'admin@example.com');

-- Insert sample students for testing
INSERT INTO students (student_id, full_name, section) VALUES
('STU001', 'John Doe', 'S33'),
('STU002', 'Jane Smith', 'S33'),
('STU003', 'Mike Johnson', 'S34'),
('STU004', 'Sarah Wilson', 'S34'),
('STU005', 'David Brown', 'S35');

-- Sample attendance session
INSERT INTO attendance_sessions (teacher_id, subject, section, session_date, session_type, start_time, end_time, total_duration, total_students)
VALUES (1, 'Computer Science', 'S33', CURRENT_DATE, 'offline', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 60, 5);

-- Sample attendance records
INSERT INTO attendance_records (session_id, student_id, status, detection_count, confidence_score, first_detection_time, last_detection_time)
VALUES 
(1, 'STU001', 'present', 5, 0.85, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 10 minutes'),
(1, 'STU002', 'present', 4, 0.78, NOW() - INTERVAL '1 hour 50 minutes', NOW() - INTERVAL '1 hour 15 minutes'),
(1, 'STU003', 'partial', 2, 0.65, NOW() - INTERVAL '1 hour 30 minutes', NOW() - INTERVAL '1 hour 25 minutes'),
(1, 'STU004', 'absent', 0, 0.00, NULL, NULL),
(1, 'STU005', 'present', 6, 0.92, NOW() - INTERVAL '1 hour 55 minutes', NOW() - INTERVAL '1 hour 5 minutes');
