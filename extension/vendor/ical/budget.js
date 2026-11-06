// Local worker budget hook; reset after each synchronous expansion.
let check = () => {};
export function setBudgetCheck(callback) { check = callback; }
export function checkBudget() { check(); }
