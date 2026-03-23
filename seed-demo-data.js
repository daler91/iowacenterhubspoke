#!/usr/bin/env node
/**
 * seed-demo-data.js
 *
 * Populates the Iowa Center Hub Spoke scheduling database with realistic
 * demo data: 5 Iowa locations, 5 employees, and 15 schedules spread across
 * the next 15 days.
 *
 * Usage:
 *   MONGO_URL=mongodb://... node seed-demo-data.js
 *
 * The script clears existing locations, employees, and schedules before
 * inserting fresh demo data, making it safe to re-run at any time.
 */

'use strict';

const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'iowa_center_hub';

if (!MONGO_URL) {
  console.error('ERROR: MONGO_URL environment variable is not set.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Demo data definitions
// ---------------------------------------------------------------------------

const LOCATIONS = [
  {
    city_name: 'Ames',
    drive_time_minutes: 35,
    latitude: 42.0308,
    longitude: -93.6319,
  },
  {
    city_name: 'Boone',
    drive_time_minutes: 45,
    latitude: 42.0597,
    longitude: -93.8802,
  },
  {
    city_name: 'Waterloo',
    drive_time_minutes: 90,
    latitude: 42.4928,
    longitude: -92.3426,
  },
  {
    city_name: 'Cedar Rapids',
    drive_time_minutes: 120,
    latitude: 41.9779,
    longitude: -91.6656,
  },
  {
    city_name: 'Des Moines',
    drive_time_minutes: 60,
    latitude: 41.5868,
    longitude: -93.625,
  },
];

const EMPLOYEES = [
  { name: 'Sarah Johnson',    email: 'sarah.johnson@example.com',    phone: '515-555-0101', color: '#4F46E5' },
  { name: 'Michael Chen',     email: 'michael.chen@example.com',     phone: '515-555-0102', color: '#0D9488' },
  { name: 'Emily Rodriguez',  email: 'emily.rodriguez@example.com',  phone: '515-555-0103', color: '#DC2626' },
  { name: 'James Wilson',     email: 'james.wilson@example.com',     phone: '515-555-0104', color: '#D97706' },
  { name: 'Lisa Anderson',    email: 'lisa.anderson@example.com',    phone: '515-555-0105', color: '#7C3AED' },
];

// Three realistic class-time windows (start_time, end_time)
const TIME_SLOTS = [
  { start_time: '09:00', end_time: '12:00' },
  { start_time: '10:00', end_time: '13:00' },
  { start_time: '11:00', end_time: '14:00' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a YYYY-MM-DD string for today + offsetDays.
 */
function futureDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the current UTC timestamp as an ISO string.
 */
function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function seed() {
  const client = new MongoClient(MONGO_URL);

  try {
    console.log('Connecting to MongoDB…');
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(`Connected to database: ${DB_NAME}`);

    // -----------------------------------------------------------------------
    // Clear existing demo collections
    // -----------------------------------------------------------------------
    console.log('\nClearing existing data…');
    const [locDel, empDel, schedDel] = await Promise.all([
      db.collection('locations').deleteMany({}),
      db.collection('employees').deleteMany({}),
      db.collection('schedules').deleteMany({}),
    ]);
    console.log(`  Removed ${locDel.deletedCount} location(s)`);
    console.log(`  Removed ${empDel.deletedCount} employee(s)`);
    console.log(`  Removed ${schedDel.deletedCount} schedule(s)`);

    // -----------------------------------------------------------------------
    // Insert locations
    // -----------------------------------------------------------------------
    console.log('\nCreating locations…');
    const locationDocs = LOCATIONS.map((loc) => ({
      id: randomUUID(),
      city_name: loc.city_name,
      drive_time_minutes: loc.drive_time_minutes,
      latitude: loc.latitude,
      longitude: loc.longitude,
      created_at: now(),
      deleted_at: null,
    }));

    await db.collection('locations').insertMany(locationDocs);
    locationDocs.forEach((loc) =>
      console.log(`  ✓ Location: ${loc.city_name} (${loc.drive_time_minutes} min drive, id: ${loc.id})`)
    );

    // -----------------------------------------------------------------------
    // Insert employees
    // -----------------------------------------------------------------------
    console.log('\nCreating employees…');
    const employeeDocs = EMPLOYEES.map((emp) => ({
      id: randomUUID(),
      name: emp.name,
      email: emp.email,
      phone: emp.phone,
      color: emp.color,
      created_at: now(),
      deleted_at: null,
    }));

    await db.collection('employees').insertMany(employeeDocs);
    employeeDocs.forEach((emp) =>
      console.log(`  ✓ Employee: ${emp.name} (${emp.color}, id: ${emp.id})`)
    );

    // -----------------------------------------------------------------------
    // Insert 15 schedules spread across the next 15 days
    // -----------------------------------------------------------------------
    console.log('\nCreating schedules…');

    // Build a deterministic but varied assignment pattern:
    //   day 1  → employee 0, location 0, slot 0
    //   day 2  → employee 1, location 1, slot 1
    //   …cycling through employees, locations, and time slots
    const scheduleDocs = [];

    for (let dayOffset = 1; dayOffset <= 15; dayOffset++) {
      const empIdx  = (dayOffset - 1) % employeeDocs.length;
      const locIdx  = (dayOffset - 1) % locationDocs.length;
      const slotIdx = (dayOffset - 1) % TIME_SLOTS.length;

      const employee = employeeDocs[empIdx];
      const location = locationDocs[locIdx];
      const slot     = TIME_SLOTS[slotIdx];
      const date     = futureDate(dayOffset);

      const doc = {
        id: randomUUID(),
        employee_id: employee.id,
        location_id: location.id,
        date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        drive_time_minutes: location.drive_time_minutes,
        town_to_town: false,
        town_to_town_warning: null,
        travel_override_minutes: null,
        notes: '',
        status: 'upcoming',
        recurrence: null,
        recurrence_end_mode: null,
        recurrence_end_date: null,
        recurrence_occurrences: null,
        recurrence_rule: null,
        location_name: location.city_name,
        employee_name: employee.name,
        employee_color: employee.color,
        class_id: null,
        class_name: null,
        class_color: null,
        created_at: now(),
        deleted_at: null,
      };

      scheduleDocs.push(doc);
      console.log(
        `  ✓ Schedule day +${String(dayOffset).padStart(2, '0')} (${date}): ` +
        `${employee.name} → ${location.city_name} ${slot.start_time}–${slot.end_time}`
      );
    }

    await db.collection('schedules').insertMany(scheduleDocs);

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n✅ Seed complete!');
    console.log(`   ${locationDocs.length} locations`);
    console.log(`   ${employeeDocs.length} employees`);
    console.log(`   ${scheduleDocs.length} schedules`);
  } catch (err) {
    console.error('\n❌ Seed failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed.');
  }
}

seed();
