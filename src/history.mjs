export class History {
  constructor({ maxTurns }) {
    this.store = new Map();
    this.cap = Math.max(2, maxTurns * 4);
  }

  get(userId) {
    return this.store.get(userId) ?? [];
  }

  append(userId, message) {
    const arr = this.store.get(userId) ?? [];
    arr.push(message);
    if (arr.length > this.cap) arr.splice(0, arr.length - this.cap);
    this.store.set(userId, arr);
  }

  reset(userId) {
    this.store.delete(userId);
  }
}
