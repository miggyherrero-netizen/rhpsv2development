-- Waitlist geo seed part 1/5 (regions + provinces). Run in order a→e. Safe to re-run.
BEGIN;

INSERT INTO ph_regions (code, name, short_name) VALUES
  ('090000000', 'Zamboanga Peninsula', 'IX'),
  ('100000000', 'Northern Mindanao', 'X'),
  ('110000000', 'Davao Region', 'XI'),
  ('120000000', 'SOCCSKSARGEN', 'XII'),
  ('160000000', 'Caraga', 'XIII'),
  ('150000000', 'BARMM', 'BARMM')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name;

INSERT INTO ph_provinces (code, name, region_code) VALUES
  ('097200000', 'Zamboanga del Norte', '090000000'),
  ('097300000', 'Zamboanga del Sur', '090000000'),
  ('098300000', 'Zamboanga Sibugay', '090000000'),
  ('101300000', 'Bukidnon', '100000000'),
  ('101800000', 'Camiguin', '100000000'),
  ('103500000', 'Lanao del Norte', '100000000'),
  ('104200000', 'Misamis Occidental', '100000000'),
  ('104300000', 'Misamis Oriental', '100000000'),
  ('112300000', 'Davao del Norte', '110000000'),
  ('112400000', 'Davao del Sur', '110000000'),
  ('112500000', 'Davao Oriental', '110000000'),
  ('118200000', 'Davao de Oro', '110000000'),
  ('118600000', 'Davao Occidental', '110000000'),
  ('124700000', 'Cotabato', '120000000'),
  ('126300000', 'South Cotabato', '120000000'),
  ('126500000', 'Sultan Kudarat', '120000000'),
  ('128000000', 'Sarangani', '120000000'),
  ('160200000', 'Agusan del Norte', '160000000'),
  ('160300000', 'Agusan del Sur', '160000000'),
  ('166700000', 'Surigao del Norte', '160000000'),
  ('166800000', 'Surigao del Sur', '160000000'),
  ('168500000', 'Dinagat Islands', '160000000'),
  ('150700000', 'Basilan', '150000000'),
  ('153600000', 'Lanao del Sur', '150000000'),
  ('153800000', 'Maguindanao', '150000000'),
  ('156600000', 'Sulu', '150000000'),
  ('157000000', 'Tawi-Tawi', '150000000')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, region_code = EXCLUDED.region_code;

COMMIT;
