# Dental Practice Management System

A classic Windows-style web application for managing dental practice operations, built with vanilla JavaScript and Supabase.

## Features (Part 1: Foundation & Authentication)

- 🔐 User authentication with Supabase
- 📊 Dashboard with practice statistics
- 👤 User profile and role management
- 🎨 Old-school Microsoft/Windows UI aesthetic
- 📱 Responsive design for mobile devices

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **Styling:** Classic Windows 95/2000 inspired CSS
- **Hosting:** Can be deployed to Vercel, Netlify, or any static host

## Prerequisites

- A Supabase account (free tier available at https://supabase.com)
- Basic understanding of SQL for database setup
- A modern web browser

## Setup Instructions

### 1. Create a Supabase Project

1. Go to https://supabase.com and sign up/login
2. Click "New Project"
3. Enter project details and create the project
4. Wait for the database to be provisioned (takes ~2 minutes)

### 2. Set Up Database Schema

1. In Supabase Dashboard, go to **SQL Editor**
2. Copy the contents of `database-schema.sql`
3. Paste into a new query and click "Run"
4. This creates all necessary tables and Row Level Security policies

### 3. Configure Environment Variables

1. In Supabase Dashboard, go to **Settings > API**
2. Copy your **Project URL**
3. Copy your **anon public** key
4. Open `js/supabase.js` and replace:
   ```javascript
   const SUPABASE_URL = 'YOUR_PROJECT_URL_HERE';
   const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
   ```

### 4. Create Your First User

1. In Supabase Dashboard, go to **Authentication > Users**
2. Click "Add user" and create an admin account
3. Note the User ID (UUID)
4. In **SQL Editor**, run:
   ```sql
   INSERT INTO profiles (id, email, full_name, role, is_active)
   VALUES ('YOUR_USER_ID_HERE', 'admin@example.com', 'Admin User', 'admin', true);
   ```

### 5. Test Locally

1. Serve the application using any local web server:
   ```bash
   # Python 3
   python3 -m http.server 8000
   
   # PHP
   php -S localhost:8000
   
   # Node.js (with http-server)
   npx http-server -p 8000
   ```
2. Open http://localhost:8000 in your browser
3. Login with your admin credentials

## Deployment

### Deploy to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel` in the project directory
3. Follow the prompts
4. Your app will be deployed!

### Deploy to Netlify

1. Push your code to GitHub
2. Connect your GitHub repo to Netlify
3. No build configuration needed
4. Deploy!

### Deploy to Apache/LAMP

1. Copy all files to your web server directory (e.g., `/var/www/html/dental`)
2. Ensure proper file permissions
3. Access via your domain

## Project Structure

```
dental-app/
├── index.html          # Main dashboard
├── login.html          # Authentication page
├── README.md           # This file
├── database-schema.sql # Supabase database setup
├── .env.example        # Environment variables template
├── css/
│   ├── style.css       # Main layout & Windows styling
│   ├── forms.css       # Form controls styling
│   ├── tables.css      # Table styling
│   └── print.css       # Print-specific styles
└── js/
    ├── supabase.js     # Supabase client configuration
    ├── auth.js         # Authentication logic
    ├── ui.js           # UI helpers (modals, notifications)
    ├── utils.js        # Utility functions
    └── app.js          # Main application logic
```

## User Roles

- **admin**: Full system access, user management
- **dentist**: Patient care, treatment planning, scheduling
- **hygienist**: Cleanings, basic procedures, patient education
- **receptionist**: Scheduling, patient intake, billing

## Security Notes

- Row Level Security (RLS) is enabled on all tables
- Users can only access data based on their assigned clinic/role
- The anon key is safe to expose (it works with RLS policies)
- Never expose your service_role key in the frontend

## Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers

## Future Parts

- **Part 2:** Patient management and search
- **Part 3:** Appointment scheduling
- **Part 4:** Clinical charting and treatment plans
- **Part 5:** Billing and invoicing
- **Part 6:** Reporting and analytics

## Support

For issues or questions, refer to:
- Supabase Documentation: https://supabase.com/docs
- JavaScript MDN: https://developer.mozilla.org/

## License

Internal use only - not for redistribution
