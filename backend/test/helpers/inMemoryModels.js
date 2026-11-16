/**
 * test/helpers/inMemoryModels.js
 * Minimal in-memory stand-ins for the Mongoose models, used by the backend
 * tests so they run without a MongoDB server.
 *
 * Semantics mirrored from MongoDB/Mongoose where the code under test relies
 * on them:
 *   - each single-document write is atomic (it completes in one JS turn);
 *   - findOneAndUpdate/findOneAndDelete apply the filter at write time and
 *     return null when nothing matches;
 *   - filters support equality, null, { $ne }, and { $in }.
 * Every operation awaits a small simulated latency so concurrent callers
 * interleave, as they would against a real database.
 *
 * This is NOT a MongoDB emulator: aggregation, schema validation, casting,
 * and indexes are out of scope.
 */

"use strict";

const LATENCY_MS = 2;
const tick = () => new Promise((r) => setTimeout(r, LATENCY_MS));
const clone = (o) => (o === null || o === undefined ? o : JSON.parse(JSON.stringify(o)));

function idOf(v) {
  return v && typeof v === "object" && "_id" in v ? v._id : v;
}

function fieldMatches(value, cond) {
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    if ("$ne" in cond) return String(idOf(value)) !== String(cond.$ne);
    if ("$in" in cond) return cond.$in.map(String).includes(String(idOf(value)));
  }
  if (cond === null) return value === null || value === undefined;
  return String(idOf(value)) === String(cond);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, cond]) => fieldMatches(doc[k], cond));
}

function pick(doc, fields) {
  if (!fields || doc === null) return doc;
  const keep = fields.split(/\s+/).filter(Boolean).filter((f) => !f.startsWith("+"));
  if (keep.length === 0) return doc;
  const out = { _id: doc._id };
  keep.forEach((f) => { if (f in doc) out[f] = doc[f]; });
  return out;
}

/**
 * Query: thenable supporting the chained calls used in the code base.
 */
class Query {
  constructor(model, exec) {
    this.model = model;
    this.exec = exec;
    this.pops = [];
    this.fields = null;
  }
  select(fields) { this.fields = fields; return this; }
  populate(spec, fields) {
    this.pops.push(typeof spec === "string" ? { path: spec, select: fields } : spec);
    return this;
  }
  sort() { return this; }
  lean() { return this; }
  then(resolve, reject) {
    return (async () => {
      await tick();
      let data = clone(this.exec());
      const apply = (doc) => {
        if (!doc) return doc;
        this.pops.forEach((p) => this.model._populate(doc, p));
        return pick(doc, this.fields);
      };
      data = Array.isArray(data) ? data.map(apply) : apply(data);
      return data;
    })().then(resolve, reject);
  }
}

/**
 * makeModel(store, refs)
 *   store: array of plain documents (mutated in place by writes)
 *   refs:  { field: () => otherModel } for populate()
 */
function makeModel(store, refs = {}) {
  const model = {
    store,
    refs,
    calls: [],
    _populate(doc, p) {
      const ref = refs[p.path];
      if (!ref || doc[p.path] === null || doc[p.path] === undefined) return;
      const target = ref().store.find((d) => String(d._id) === String(idOf(doc[p.path])));
      let sub = target ? clone(target) : null;
      if (sub && p.populate) ref()._populate(sub, p.populate);
      doc[p.path] = sub ? pick(sub, p.select) : null;
    },
    find(filter) {
      return new Query(model, () => store.filter((d) => matches(d, filter)));
    },
    findById(id) {
      return new Query(model, () => store.find((d) => String(d._id) === String(id)) || null);
    },
    findOne(filter) {
      return new Query(model, () => store.find((d) => matches(d, filter)) || null);
    },
    async findOneAndUpdate(filter, update) {
      model.calls.push({ op: "findOneAndUpdate", filter });
      await tick();
      const d = store.find((x) => matches(x, filter));
      if (!d) return null;
      Object.assign(d, update.$set || {});
      return clone(d);
    },
    async findByIdAndUpdate(id, update) {
      model.calls.push({ op: "findByIdAndUpdate", id });
      await tick();
      const d = store.find((x) => String(x._id) === String(id));
      if (!d) return null;
      Object.assign(d, update.$set || {});
      return clone(d);
    },
    async findOneAndDelete(filter) {
      model.calls.push({ op: "findOneAndDelete", filter });
      await tick();
      const i = store.findIndex((x) => matches(x, filter));
      if (i === -1) return null;
      return clone(store.splice(i, 1)[0]);
    },
    async findByIdAndDelete(id) {
      model.calls.push({ op: "findByIdAndDelete", id });
      await tick();
      const i = store.findIndex((x) => String(x._id) === String(id));
      return i === -1 ? null : clone(store.splice(i, 1)[0]);
    },
    async create(doc) {
      await tick();
      const d = { _id: doc._id || `id${store.length + 1}_${Date.now()}`, ...doc };
      store.push(d);
      return clone(d);
    },
  };
  return model;
}

module.exports = { makeModel, matches };
