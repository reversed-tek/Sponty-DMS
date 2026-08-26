-- ============================================================================
-- PART 4: DENTAL RECORDS MANAGEMENT - SCHEMA EXTENSION
-- ============================================================================
-- Additional tables for comprehensive clinical records management
-- Run this in Supabase SQL Editor after the main schema

-- ============================================================================
-- CLINICAL NOTES TABLE
-- ============================================================================
-- Stores visit notes and clinical observations
CREATE TABLE IF NOT EXISTS clinical_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES clinics(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    appointment_id UUID REFERENCES appointments(id),
    dentist_id UUID REFERENCES profiles(id) NOT NULL,
    note_date DATE NOT NULL DEFAULT CURRENT_DATE,
    note_category TEXT CHECK (note_category IN ('general', 'follow_up', 'emergency', 'consultation', 'treatment')) DEFAULT 'general',
    chief_complaint TEXT,
    clinical_findings TEXT NOT NULL,
    diagnosis_summary TEXT,
    treatment_plan TEXT,
    notes TEXT,
    is_private BOOLEAN DEFAULT false,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clinical_notes_clinic ON clinical_notes(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient ON clinical_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_date ON clinical_notes(note_date DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_dentist ON clinical_notes(dentist_id);

-- ============================================================================
-- MEDICAL CONDITIONS TABLE
-- ============================================================================
-- Stores patient medical conditions and ongoing health issues
CREATE TABLE IF NOT EXISTS medical_conditions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES clinics(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    condition_name TEXT NOT NULL,
    condition_type TEXT CHECK (condition_type IN ('chronic', 'acute', 'resolved', 'managed')) DEFAULT 'chronic',
    diagnosed_date DATE,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medical_conditions_patient ON medical_conditions(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_conditions_clinic ON medical_conditions(clinic_id);

-- ============================================================================
-- MEDICATIONS TABLE
-- ============================================================================
-- Stores current patient medications
CREATE TABLE IF NOT EXISTS medications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES clinics(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    medication_name TEXT NOT NULL,
    dosage TEXT,
    frequency TEXT,
    start_date DATE,
    end_date DATE,
    prescribing_doctor TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medications_patient ON medications(patient_id);
CREATE INDEX IF NOT EXISTS idx_medications_clinic ON medications(clinic_id);

-- ============================================================================
-- ALLERGIES TABLE
-- ============================================================================
-- Stores detailed allergy information
CREATE TABLE IF NOT EXISTS patient_allergies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES clinics(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    allergen TEXT NOT NULL,
    allergy_type TEXT CHECK (allergy_type IN ('medication', 'food', 'environmental', 'material', 'other')) DEFAULT 'other',
    severity TEXT CHECK (severity IN ('mild', 'moderate', 'severe', 'life-threatening')) DEFAULT 'moderate',
    reaction TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allergies_patient ON patient_allergies(patient_id);
CREATE INDEX IF NOT EXISTS idx_allergies_clinic ON patient_allergies(clinic_id);

-- ============================================================================
-- DIAGNOSES TABLE
-- ============================================================================
-- Stores dental diagnoses with ICD-10 codes
CREATE TABLE IF NOT EXISTS diagnoses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES clinics(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    appointment_id UUID REFERENCES appointments(id),
    dentist_id UUID REFERENCES profiles(id) NOT NULL,
    diagnosis_code TEXT,
    diagnosis_name TEXT NOT NULL,
    tooth_number TEXT,
    tooth_surface TEXT,
    diagnosis_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT CHECK (status IN ('active', 'resolved', 'chronic', 'monitoring')) DEFAULT 'active',
    severity TEXT CHECK (severity IN ('mild', 'moderate', 'severe')) DEFAULT 'moderate',
    notes TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnoses_patient ON diagnoses(patient_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_clinic ON diagnoses(clinic_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_date ON diagnoses(diagnosis_date DESC);

-- ============================================================================
-- DENTAL CHART RECORDS TABLE
-- ============================================================================
-- Stores tooth-specific conditions and treatments
CREATE TABLE IF NOT EXISTS dental_chart_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES clinics(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    appointment_id UUID REFERENCES appointments(id),
    tooth_number TEXT NOT NULL,
    tooth_surface TEXT,
    condition_type TEXT CHECK (condition_type IN ('healthy', 'cavity', 'filling', 'crown', 'bridge', 'implant', 'root_canal', 'extraction', 'missing', 'fractured', 'other')) NOT NULL,
    condition_status TEXT CHECK (condition_status IN ('existing', 'treatment_needed', 'treatment_planned', 'treatment_completed')) DEFAULT 'existing',
    notes TEXT,
    recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
    recorded_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dental_chart_patient ON dental_chart_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_dental_chart_clinic ON dental_chart_records(clinic_id);
CREATE INDEX IF NOT EXISTS idx_dental_chart_tooth ON dental_chart_records(patient_id, tooth_number);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE dental_chart_records ENABLE ROW LEVEL SECURITY;

-- Clinical Notes Policies
CREATE POLICY "Users can view clinical notes from their clinic"
    ON clinical_notes FOR SELECT
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Dentists can create clinical notes"
    ON clinical_notes FOR INSERT
    WITH CHECK (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Dentists can update their own notes"
    ON clinical_notes FOR UPDATE
    USING (dentist_id = auth.uid() OR clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'dentist')));

-- Medical Conditions Policies
CREATE POLICY "Users can view medical conditions from their clinic"
    ON medical_conditions FOR SELECT
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Staff can manage medical conditions"
    ON medical_conditions FOR ALL
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- Medications Policies
CREATE POLICY "Users can view medications from their clinic"
    ON medications FOR SELECT
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Staff can manage medications"
    ON medications FOR ALL
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- Allergies Policies
CREATE POLICY "Users can view allergies from their clinic"
    ON patient_allergies FOR SELECT
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Staff can manage allergies"
    ON patient_allergies FOR ALL
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- Diagnoses Policies
CREATE POLICY "Users can view diagnoses from their clinic"
    ON diagnoses FOR SELECT
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Dentists can manage diagnoses"
    ON diagnoses FOR ALL
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- Dental Chart Policies
CREATE POLICY "Users can view dental charts from their clinic"
    ON dental_chart_records FOR SELECT
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Dentists can manage dental charts"
    ON dental_chart_records FOR ALL
    USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

CREATE TRIGGER update_clinical_notes_updated_at BEFORE UPDATE ON clinical_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medical_conditions_updated_at BEFORE UPDATE ON medical_conditions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medications_updated_at BEFORE UPDATE ON medications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_allergies_updated_at BEFORE UPDATE ON patient_allergies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_diagnoses_updated_at BEFORE UPDATE ON diagnoses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dental_chart_updated_at BEFORE UPDATE ON dental_chart_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- END OF PART 4 SCHEMA EXTENSION
-- ============================================================================
