-- Correct the starter signup capacity on databases that already applied 0001.
-- Run this migration against the intended Preview D1 database before opening signup to clients.
DROP TRIGGER IF EXISTS users_initial_capacity;
CREATE TRIGGER users_initial_capacity
BEFORE INSERT ON users
WHEN NEW.role = 'customer'
 AND (SELECT COUNT(*) FROM users WHERE role = 'customer' AND lower(email) <> 'sergiouai3@gmail.com') >= 10
BEGIN
  SELECT RAISE(ABORT, 'USER_CAPACITY_REACHED');
END;
