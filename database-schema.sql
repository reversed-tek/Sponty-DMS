-- Dental Practice Management System - Database Schema
-- Part 1: Foundation & Authentication
-- Run this script in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
-- Stores user profile information and roles
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'dentist', 'hygienist', 'receptionist')),
    phone TEXT,
    clinic_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_clinic ON profiles(clinic_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ============================================================================
-- CLINICS TABLE
-- ============================================================================
-- Stores clinic/branch information for multi-location support
CREATE TABLE IF NOT EXISTS clinics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    phone TEXT,
    email TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- PATIENTS TABLE
-- ============================================================================
-- Stores patient demographic and contact information
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_number TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    email TEXT,
    phone TEXT,
    mobile TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    insurance_provider TEXT,
    insurance_policy_number TEXT,
    medical_notes TEXT,
    allergies TEXT,
    clinic_id UUID REFERENCES clinics(id),
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for faster searches
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_number ON patients(patient_number);
CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_dob ON patients(date_of_birth);

-- ============================================================================
-- APPOINTMENTS TABLE
-- ============================================================================
-- Stores appointment scheduling information
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    dentist_id UUID REFERENCES profiles(id),
    clinic_id UUID REFERENCES clinics(id),
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    appointment_type TEXT NOT NULL CHECK (appointment_type IN ('checkup', 'cleaning', 'filling', 'extraction', 'root_canal', 'crown', 'emergency', 'consultation', 'other')),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
    notes TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for appointment queries
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_dentist ON appointments(dentist_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic ON appointments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- ============================================================================
-- TREATMENTS TABLE
-- ============================================================================
-- Stores treatment records and procedures performed
CREATE TABLE IF NOT EXISTS treatments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),
    dentist_id UUID REFERENCES profiles(id),
    treatment_date DATE NOT NULL,
    tooth_number TEXT,
    procedure_code TEXT,
    procedure_name TEXT NOT NULL,
    description TEXT,
    cost DECIMAL(10,2),
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    notes TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for treatment queries
CREATE INDEX IF NOT EXISTS idx_treatments_patient ON treatments(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_dentist ON treatments(dentist_id);
CREATE INDEX IF NOT EXISTS idx_treatments_date ON treatments(treatment_date);
CREATE INDEX IF NOT EXISTS idx_treatments_appointment ON treatments(appointment_id);

-- ============================================================================
-- INVOICES TABLE
-- ============================================================================
-- Stores billing and payment information
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number TEXT UNIQUE NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),
    invoice_date DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    tax DECIMAL(10,2) DEFAULT 0,
    discount DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    amount_paid DECIMAL(10,2) DEFAULT 0,
    balance DECIMAL(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled')),
    payment_method TEXT CHECK (payment_method IN ('cash', 'credit_card', 'debit_card', 'check', 'insurance', 'other')),
    notes TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for invoice queries
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- ============================================================================
-- INVOICE ITEMS TABLE
-- ============================================================================
-- Stores individual line items for invoices
CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    treatment_id UUID REFERENCES treatments(id),
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for invoice items
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read their own profile, admins can read all
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can update profiles" ON profiles
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can insert profiles" ON profiles
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Clinics: All authenticated users can view clinics
CREATE POLICY "Authenticated users can view clinics" ON clinics
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage clinics" ON clinics
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Patients: Users can view patients from their clinic
CREATE POLICY "Users can view clinic patients" ON patients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND (clinic_id = patients.clinic_id OR role = 'admin')
        )
    );

CREATE POLICY "Users can create patients" ON patients
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND (clinic_id = patients.clinic_id OR role = 'admin')
        )
    );

CREATE POLICY "Users can update patients" ON patients
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND (clinic_id = patients.clinic_id OR role = 'admin')
        )
    );

-- Appointments: Users can view appointments from their clinic
CREATE POLICY "Users can view clinic appointments" ON appointments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND (clinic_id = appointments.clinic_id OR role = 'admin')
        )
    );

CREATE POLICY "Users can create appointments" ON appointments
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND (clinic_id = appointments.clinic_id OR role = 'admin')
        )
    );

CREATE POLICY "Users can update appointments" ON appointments
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND (clinic_id = appointments.clinic_id OR role = 'admin')
        )
    );

-- Treatments: Dentists and admins can manage treatments
CREATE POLICY "Clinical staff can view treatments" ON treatments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND role IN ('admin', 'dentist', 'hygienist')
        )
    );

CREATE POLICY "Clinical staff can create treatments" ON treatments
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND role IN ('admin', 'dentist', 'hygienist')
        )
    );

CREATE POLICY "Clinical staff can update treatments" ON treatments
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND role IN ('admin', 'dentist', 'hygienist')
        )
    );

-- Invoices: Staff can view/manage invoices
CREATE POLICY "Staff can view invoices" ON invoices
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can create invoices" ON invoices
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Staff can update invoices" ON invoices
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Invoice Items: Linked to invoice permissions
CREATE POLICY "Staff can view invoice items" ON invoice_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id = invoice_items.invoice_id
        )
    );

CREATE POLICY "Staff can create invoice items" ON invoice_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id = invoice_items.invoice_id
        )
    );

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to all tables with updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clinics_updated_at BEFORE UPDATE ON clinics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_treatments_updated_at BEFORE UPDATE ON treatments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate sequential patient numbers
CREATE OR REPLACE FUNCTION generate_patient_number()
RETURNS TEXT AS $$
DECLARE
    next_num INTEGER;
    new_number TEXT;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(patient_number FROM 2) AS INTEGER)), 0) + 1
    INTO next_num
    FROM patients
    WHERE patient_number ~ '^P[0-9]+$';
    
    new_number := 'P' || LPAD(next_num::TEXT, 6, '0');
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Function to generate sequential invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
    next_num INTEGER;
    new_number TEXT;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 4) AS INTEGER)), 0) + 1
    INTO next_num
    FROM invoices
    WHERE invoice_number ~ '^INV[0-9]+$';
    
    new_number := 'INV' || LPAD(next_num::TEXT, 6, '0');
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED DATA (Optional - for testing)
-- ============================================================================

-- Insert a default clinic
INSERT INTO clinics (id, name, address, city, state, zip, phone, email)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Main Dental Clinic',
    '123 Main Street',
    'Springfield',
    'IL',
    '62701',
    '(555) 123-4567',
    'info@maindentalclinic.com'
) ON CONFLICT (id) DO NOTHING;

-- Note: After running this schema, create your first admin user via Supabase Auth UI,
-- then insert their profile manually using the user ID from auth.users:
--
-- INSERT INTO profiles (id, email, full_name, role, clinic_id, is_active)
-- VALUES (
--     'YOUR_USER_ID_FROM_AUTH',
--     'admin@example.com',
--     'Admin User',
--     'admin',
--     '00000000-0000-0000-0000-000000000001',
--     true
-- );

-- ============================================================================
-- SCHEMA COMPLETE
-- ============================================================================
-- This schema provides the foundation for:
-- - User authentication and profiles with role-based access
-- - Multi-clinic support
-- - Patient demographics and medical history
-- - Appointment scheduling
-- - Treatment tracking
-- - Billing and invoicing
-- - Row Level Security for data protection
-- ============================================================================
