#!/usr/bin/env bash
cat > validate_user.js <<'JSEOF'
function createUser(data) {
  if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
    throw new Error('name is required');
  }
  if (!data.email || typeof data.email !== 'string' || !data.email.includes('@')) {
    throw new Error('email is invalid');
  }
  if (
    data.age === undefined ||
    data.age === null ||
    typeof data.age !== 'number' ||
    !Number.isInteger(data.age) ||
    data.age < 0
  ) {
    throw new Error('age must be a non-negative integer');
  }
  return { name: data.name, email: data.email, age: data.age };
}

module.exports = { createUser };
JSEOF
