import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readRoster, coachesFrom, splitName } from './roster.ts';

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
