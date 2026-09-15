function createUser(data) {
  // TODO: validate `data` before creating the user (see the task prompt
  // for the exact required error messages and check order: name, then
  // email, then age).
  return { name: data.name, email: data.email, age: data.age };
}

module.exports = { createUser };
