import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readRoster, readCoaches, coachesFrom, splitName, closestSchool, readRegSheet, regTotals, schoolsNotHere } from './roster.ts';

test('coach list CSV', () => {
  const csv = [
    'Coach,Cell,Email,Campus',
    '"SMITH, PAT",214-555-0100,PSmith@Example.org,"001 - Sample High School"',
    'Lee Ann,,lee@example.org,North',
    'No Mail,214-555-0101,,North',
    'Dup,,psmith@example.org,North',
  ].join('\n');
  const { rows, problems, missing } = readCoaches(csv);
  assert.deepEqual(missing, []);
  assert.deepEqual(rows, [
    { name: 'Pat Smith', email: 'psmith@example.org', phone: '214-555-0100', school: 'Sample High School' },
    { name: 'Lee Ann', email: 'lee@example.org', phone: null, school: 'North' },
  ]);
  assert.equal(problems.length, 2);
  assert.deepEqual(readCoaches('Name,Phone\nx,1').missing, ['email', 'school']);
});

test('quoted commas and doubled quotes', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
});

test('district export shape', () => {
  const csv = [
    'Student ID,Student Name,Grade,School,Coach,Coach Phone,Coach Email',
    '1000001,"Doe, Jane Marie",9,"001 - Sample High School","SMITH, PAT",214-555-0100,PSmith@example.org',
    '1000002,"Roe, Sam",10,"001 - Sample High School","SMITH, PAT",214-555-0100,psmith@example.org',
    '1000003,"Bad, Grade",K,"002 - Other HS",,,',
  ].join('\n');
  const { rows, problems, missing } = readRoster(csv);
  assert.deepEqual(missing, []);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    student_id: '1000001', first_name: 'Jane Marie', last_name: 'Doe', grade: 9, school: 'Sample High School',
    coach_name: 'Pat Smith', coach_email: 'psmith@example.org', coach_phone: '214-555-0100',
  });
  assert.equal(problems.length, 1);
  assert.equal(coachesFrom(rows).length, 1);
});

test('first/last columns and missing headers', () => {
  const r = readRoster('First Name,Last Name,Grade,Campus\nann,LEE,11,North');
  assert.equal(r.rows[0].first_name, 'Ann');
  assert.equal(r.rows[0].last_name, 'Lee');
  assert.deepEqual(readRoster('Name,School\nx,y').missing, ['grade']);
  assert.deepEqual(splitName('Mary Ann Smith'), ['Mary Ann', 'Smith']);
});

test('column picks override guesses', () => {
  const csv = 'Kid,Yr,Building\nAnn Lee,9,North';
  assert.deepEqual(readRoster(csv).missing, ['student name', 'grade', 'school']);
  const r = readRoster(csv, { name: 0, grade: 1, school: 2 });
  assert.deepEqual(r.missing, []);
  assert.equal(r.rows[0].last_name, 'Lee');
  assert.deepEqual(r.headers, ['Kid', 'Yr', 'Building']);
});

test('closest school', () => {
  const schools = ['Skyline High School', 'Sunset High School', 'W. T. White High School', 'Wilmer-Hutchins High School'];
  assert.equal(closestSchool('Skyline HS', schools), 'Skyline High School');
  assert.equal(closestSchool('skyline', schools), 'Skyline High School');
  assert.equal(closestSchool('WT White', schools), 'W. T. White High School');
  assert.equal(closestSchool('Wilmer Hutchins HS', schools), 'Wilmer-Hutchins High School');
  assert.equal(closestSchool('Lincoln', schools), null);
});

test('closest school, district short names', () => {
  const schools = ['ALEXANDER', 'BAYLES', 'BLACK', 'BLAIR'];
  assert.equal(closestSchool('Alexander Elementary', schools), 'ALEXANDER');
  assert.equal(closestSchool('Bayles ES', schools), 'BAYLES');
  assert.equal(closestSchool('Black Elementary School', schools), 'BLACK');
});

test('loose header guesses and sample row', () => {
  const r = readCoaches('Coach Full Name,Cell Phone Number,E-mail Address,School Name\nPat Smith,214-555-0100,p@example.org,North');
  assert.deepEqual(r.map, { name: 0, phone: 1, email: 2, school: 3 });
  assert.deepEqual(r.sample, ['Pat Smith', '214-555-0100', 'p@example.org', 'North']);
});

test('registration sheet counts', () => {
  const perCoach = readRegSheet(['Coach,Campus,# Registered', 'A,001 - ALEXANDER,5', 'B,ALEXANDER,3', 'C,Bayles ES,x', 'D,,2'].join('\n'));
  assert.deepEqual(perCoach.map, { school: 1, count: 2, coach: 0 });
  assert.equal(perCoach.problems.length, 1);
  assert.deepEqual(regTotals(perCoach.rows, (x) => closestSchool(x, ['ALEXANDER', 'BAYLES']) ?? x), { ALEXANDER: 8 });
  const perStudent = readRegSheet(['Student,School', 'Ann,BAYLES', 'Bo,Bayles ES', 'Cy,ALEXANDER'].join('\n'));
  assert.equal(perStudent.map.count, undefined);
  assert.deepEqual(regTotals(perStudent.rows, (x) => closestSchool(x, ['ALEXANDER', 'BAYLES']) ?? x), { BAYLES: 2, ALEXANDER: 1 });
});

test('check-in sheet: coaches, counts, schools not here', () => {
  const csv = ['Campus,Coach,Email,Checked in,#STU,#Shirt,Coach cell',
    'ALEXANDER,"HERRERA, MARIO",MHerrera@example.org,TRUE,8,9,469-555-0170',
    'ALEXANDER,"SMITH, ANN",asmith@example.org,FALSE,,1,',
    'BAYLES ES,"CONDE, LORANE",lconde@example.org,FALSE,14,15,787-555-0100',
    '61,,,FALSE,667,,'].join('\n');
  const p = readRegSheet(csv);
  assert.deepEqual(p.map, { school: 0, count: 4, coach: 1, email: 2, phone: 6, checked: 3 });
  assert.deepEqual(p.rows[0], { school: 'ALEXANDER', n: 8, coach: 'Mario Herrera', email: 'mherrera@example.org', phone: '469-555-0170', checked: true });
  assert.equal(p.rows[1].n, 0);
  const fix = (x: string) => closestSchool(x, ['ALEXANDER', 'BAYLES']) ?? x;
  assert.deepEqual(regTotals(p.rows, fix), { ALEXANDER: 8, BAYLES: 14, '61': 667 });
  assert.deepEqual(schoolsNotHere(p.rows, fix, ['ALEXANDER', 'BAYLES']), ['BAYLES']);
});
