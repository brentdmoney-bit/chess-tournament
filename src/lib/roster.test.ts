import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readRoster, readCoaches, coachesFrom, splitName, closestSchool } from './roster.ts';

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
