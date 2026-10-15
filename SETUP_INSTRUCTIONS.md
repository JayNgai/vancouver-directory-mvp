# Setup Instructions - Vancouver Directory MVP

**Project Location:** `C:\Users\jayng\Documents\Directory Sites/vancouver-directory-mvp`  
**Status:** Structure Complete → Awaiting Database & Dependencies  
**Last Updated:** 2026-10-09 21:57

---

## QUICK START (Monday Review)

### 1. Install Node.js Dependencies
```bash
cd C:\Users\jayng\Documents\Directory Sites\vancouver-directory-mvp
npm install
```

### 2. Create PostgreSQL Database
```bash
# On Windows, using psql or pgAdmin:
CREATE DATABASE vancouver_directory;

# OR update .env with your existing DB credentials and run:
npm run db:migrate
```

### 3. Start Development Server
```bash
npm run dev
```

Visit `http://localhost:3000` to see the directory site.

---

## DETAILED SETUP GUIDE

### Prerequisites
- **Node.js** (v18+) installed and available in PATH
- **PostgreSQL** running locally (or use Docker)

### Step 1: Install Dependencies
```bash
cd C:\Users\jayng\Documents\Directory Sites\vancouver-directory-mvp
npm install
```

Expected output: `added XXX packages`

If you see errors, ensure:
- Node.js version is 18+ (check with `node --version`)
- npm is accessible in PATH

### Step 2: Configure Database

**Option A: Use Local PostgreSQL**
```sql
-- Connect to PostgreSQL and create database:
CREATE DATABASE vancouver_directory;
```

Update `.env` file with your credentials:
```env
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/vancouver_directory"
```

**Option B: Use Docker (Recommended for Quick Setup)**
```bash
# Create a docker-compose.yml in project root:
docker run --name vancouver-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres

# Then update .env:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vancouver_directory"

# Create the database:
docker exec -it vancouver-db createdb vancouver_directory
```

### Step 3: Run Database Migrations
```bash
npm run db:migrate
```

This creates all tables from `prisma/schema.prisma`.

### Step 4: Seed Sample Data (Optional)
```bash
npm run db:seed
```

This populates the database with sample neighborhoods and businesses.

### Step 5: Start Development Server
```bash
npm run dev
```

Server will start on `http://localhost:3000`

---

## PROJECT STRUCTURE

```
vancouver-directory-mvp/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── controllers/           # Request handlers
│   ├── routes/                # API routes
│   ├── middleware/            # Auth, error handling
│   └── utils/                 # Helper functions
├── public/
│   └── styles.css             # Base stylesheet
├── templates/
│   └── base.html              # HTML template
├── uploads/                   # File uploads
├── server.js                  # Express app entry
├── package.json               # Dependencies
├── .env                       # Environment config
└── README.md                  # Documentation
```

---

## API ENDPOINTS (Available after setup)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/neighborhoods` | GET | List all neighborhoods |
| `/api/businesses` | GET | All businesses with filters |
| `/api/events` | GET | Event listings |
| `/api/itineraries/:id` | GET | Itinerary details |

---

## TROUBLESHOOTING

### Error: "Cannot find module 'express'"
Run: `npm install` in project directory

### Error: Database connection failed
- Check PostgreSQL is running (`pg_isready`)
- Verify DATABASE_URL in `.env`
- Ensure database exists (`vancouver_directory`)

### Server won't start
- Check for port conflicts (PORT=3000 in .env)
- View error logs in terminal

---

## NEXT STEPS AFTER BASE SETUP

Once the server is running with base structure:

1. **Friday Evening:** Write content for 10 neighborhoods
2. **Saturday Morning:** Create business profiles (~100 businesses)
3. **Saturday Afternoon:** Add search/filter functionality
4. **Sunday:** Deploy to staging environment

---

## STATUS SUMMARY

✅ Project structure complete  
✅ All source files created  
⏳ Awaiting: npm install + database setup  
⏳ Next: Content population and API implementation  

**Estimated time to first visit:** 5-10 minutes (install dependencies only)

---

## CONTACT

Return Monday for progress review. Build will continue incrementally during the weekend.
