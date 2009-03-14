// Copyright (c) 2008 Tony Garnock-Jones <tonyg@lshift.net>
// Copyright (c) 2008 LShift Ltd. <query@lshift.net>
//
// Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation files
// (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge,
// publish, distribute, sublicense, and/or sell copies of the Software,
// and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
// BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

var Mc = {
    _debugMode: false,

    Util: {
        random_hex_string: function(n) {
            var digits = "0123456789abcdef";
            var result = "";
            for (var i = 0; i < n; i++) {
                result = result + digits[Math.floor(Math.random() * 16)];
            }
            return result;
        },

        random_uuid: function() {
            if (Mc._debugMode) {
                return Mc.Util.random_hex_string(8);
            } else {
                return [Mc.Util.random_hex_string(8),
                        Mc.Util.random_hex_string(4),
                        "4" + Mc.Util.random_hex_string(3),
                        ((Math.floor(Math.random() * 256) & ~64) | 128).toString(16) +
                        Mc.Util.random_hex_string(2),
                        Mc.Util.random_hex_string(12)].join("-");
            }
        },

        dict_union: function(s1, s2) {
            var result = {};
            var k;
            for (k in s2) { result[k] = s2[k]; }
            for (k in s1) { result[k] = s1[k]; }
            return result;
        },

        dict_difference: function(s1, s2) {
            var result = {};
            var k;
            for (k in s1) { result[k] = s1[k]; }
            for (k in s2) { delete result[k]; }
            return result;
        },

        dict_to_set: function(d) {
	    var result = {};
            for (var k in d) { result[k] = 1; }
            return result;
        },

        deepCopy: function(obj) {
            // Courtesy of
            // http://keithdevens.com/weblog/archive/2007/Jun/07/javascript.clone
            //
            // Does not handle recursive structures.

            if (obj === null || typeof(obj) != 'object') {
                return obj;
            }

            var temp = obj.constructor();
            for (var key in obj) {
                temp[key] = Mc.Util.deepCopy(obj[key]);
            }
            return temp;
        }
    },

    ObjectTypes: {
	simpleScalar: {
	    merge: function(v1, v0, v2) {
		if (v1 == v2) return {objectType: "scalar", ok: v1};
		if (v1 == v0) return {objectType: "scalar", ok: v2};
		if (v2 == v0) return {objectType: "scalar", ok: v1};
		return {objectType: "scalar", conflict: {a: v1, o: v0, b: v2}};
            }
	},

        simpleText: {
	    merge: function(v1, v0, v2) {
		var mergeResult = Diff.diff3_merge(v1, v0, v2, true);
		if (mergeResult.length == 1 && ("ok" in mergeResult[0])) {
		    return {objectType: "text", ok: mergeResult[0].ok};
		} else {
		    return {objectType: "text", result: mergeResult};
		}
            }
	},

	simpleObject: {
	    merge: function(v1, v0, v2, mergerTable) {
		var props = Mc.Util.dict_union(v1, v2);
		var bResult = {};
		var failures = {};
		var haveConflicts = false;
		if (!mergerTable) {
		    mergerTable = Mc.SimpleObjectMergerTable;
		}
		for (var prop in props) {
		    var merger = mergerTable[prop] || Mc.ObjectTypes.simpleScalar.merge;
		    var mergedPropValue = merger(v1[prop], v0[prop], v2[prop]);
		    if (("ok" in mergedPropValue) && (typeof(mergedPropValue.ok) != "undefined")) {
			bResult[prop] = mergedPropValue.ok;
		    } else {
			failures[prop] = mergedPropValue;
			haveConflicts = true;
		    }
		}

		if (haveConflicts) {
		    return {objectType: "object", partial: bResult, conflicts: failures};
		} else {
		    return {objectType: "object", ok: bResult};
		}
	    }
	},

	basicIndex: {
	    construct: function (repo) { return new Index(repo); },
	    unpickle: function (constructed, blob, repo) {
		constructed.loadFrom(blob);
	    },
	    merge: function(v1, ignored_v0, v2) {
		// We don't need to examine v0 at all here.
		var result = new Mc.Index(v1.repo());
		var conflicts = {};
		var haveConflicts = false;

		result.dead = Mc.Util.dict_union(v1.dead, v2.dead);

		var aliveKeys = Mc.Util.dict_union(v1.alive, v2.alive);
		for (var aliveKey in aliveKeys) {
		    if (!result.dead[aliveKey]) {
			var v1a = v1.alive[aliveKey];
			var v2a = v2.alive[aliveKey];
			if (v1a == v2a) {
			    result.alive[aliveKey] = v1a;
			} else {
			    var mergeResult = result.repo().merge(v1a, v2a);
			    if ("ok" in mergeResult) {
				result.alive[aliveKey] = mergeResult.mergeBlobId;
			    } else {
				haveConflicts = true;
				conflicts[aliveKey] = {a: v1a, b: v2a, details: mergeResult};
			    }
			}
		    }
		}

		if (haveConflicts) {
		    return {objectType: "index", partial: result, conflicts: conflicts};
		} else {
		    return {objectType: "index", ok: result};
		}
	    }
	}
    },

    TypeDirectory: {},
    SimpleObjectMergerTable: {},

    Index: function(repo) {
	this.alive = {};
	this.dead = {};
	this.repo = function () { return repo; };
    },

    Repository: function() {
	this.repo_id = Mc.Util.random_uuid();
	this.blobs = {}; // blobid -> blobrecord
	this.tags = {}; // repoid/bookmarkname -> blobid
	this.remotes = {}; // remotename -> remote_repo_id

	var index = new Mc.Index(this);
	this.tags[this.repo_id + "/master"] = this.store(index, "index").id;
    },

    Checkout: function(repo, blobIdOrTag) {
	this.repo = function () { return repo; }
	this.dirty = {};
	this.anyDirty = false;
	this.originalIndexBlobId = repo.resolve(blobIdOrTag);
	this.index = repo.lookup(this.originalIndexBlobId, false);
	if (this.index.objectType != "index") {
	    throw {message: "Cannot checkout blob that is not of index type",
		   blobIdOrTag: blobIdOrTag};
	}
    },
};

Mc.TypeDirectory["scalar"] = Mc.ObjectTypes.simpleScalar;
Mc.TypeDirectory["text"] = Mc.ObjectTypes.simpleText;
Mc.TypeDirectory["object"] = Mc.ObjectTypes.simpleObject;
Mc.TypeDirectory["index"] = Mc.ObjectTypes.basicIndex;

Mc.SimpleObjectMergerTable["text"] = Mc.ObjectTypes.simpleText.merge;

/*
Mc.Index.prototype.loadFrom = function(blob) {
    this.alive = Mc.Util.deepCopy(blob.alive);
    this.dead = Mc.Util.deepCopy(blob.dead);
}

Mc.Index.prototype.insert = function(value) {
    var key = Mc.Util.random_uuid();
    if (Mc._debugMode) { key = "indexkey-" + key; }
    this.alive[key] = value;
    return key;
};

Mc.Index.prototype.update = function(key, value) {
    if (!this.alive[key]) return false;
    this.alive[key] = value;
    return true;
};

Mc.Index.prototype.remove = function(key) {
    if (!this.alive[key]) return false;
    delete this.alive[key];
    this.dead[key] = 1;
    return true;
};

Mc.Index.prototype.exists = function(key) {
    return !!(this.alive[key]);
};

Mc.Index.prototype.lookup = function(key) {
    return this.repo().lookup(this.alive[key]);
};

Mc.Index.prototype.forEachBlob = function(f) {
    for (var key in this.alive) {
	f(key, this.lookup(key));
    }
};
*/

Mc.Repository.prototype.resolve = function(blobIdOrTag) {
    if (blobIdOrTag in this.blobs) {
	return blobIdOrTag;
    } else {
	if (!blobIdOrTag) {
	    blobIdOrTag = "master";
	}

	var slashPos = blobIdOrTag.indexOf("/");
	if (slashPos == -1) {
	    blobIdOrTag = this.repo_id + "/" + blobIdOrTag;
	} else {
	    var remoteName = blobIdOrTag.substring(0, slashPos);
	    var bookmarkName = blobIdOrTag.substring(slashPos + 1);
	    var repoId = this.remotes[remoteName];
	    if (repoId) { remoteName = repoId; }
	    blobIdOrTag = remoteName + "/" + bookmarkName;
	}
	return this.tags[blobIdOrTag];
    }
};

Mc.Repository.prototype.lookup = function(blobIdOrTag, shouldResolve) {
    // shouldResolve is an optional parameter defaulting to true,
    // hence the odd test in the line below
    var resolved = (shouldResolve !== false) ? this.resolve(blobIdOrTag) : blobIdOrTag;
    return (resolved && this.blobs[resolved]) || null;
};

Mc.Repository.prototype.store = function(blob, objectType, directParent, additionalParent) {
    var json = JSON.stringify(blob);
    var blobId = SHA1.hex_sha1(SHA1.encode_utf8(json));
    if (Mc._debugMode) { newBodyId = "blob-" + blobId; }
    var entry = {
	id: blobId,
	objectType: objectType,
	directParent: directParent,
	additionalParent: additionalParent,
	blob: json
    };
    this.blobs[blobId] = entry;
    return entry;
};

Mc.Repository.prototype.lookupParents = function (blobId) {
    var b = this.lookup(blobId);
    var result = [];
    if (b.mc_version_data) {
	b = b.mc_version_data;
	if (b.directParent) result.push(b.directParent);
	if (b.additionalParent) result.push(b.additionalParent);
    }
    return result;
};

Mc.Repository.prototype.canMerge = function(b1, b2) {
    var $elf = this;
    function lookupParents(blobId) { return $elf.lookupParents(blobId); }
    var ancestorBlobId = Graph.least_common_ancestor(lookupParents, b1, b2);
    return !(b1 == ancestorBlobId || b2 == ancestorBlobId);
};

Mc.Repository.prototype.merge = function(b1, b2) {
    var blob1 = this.lookup(b1);
    var blob2 = this.lookup(b2);

    var $elf = this;
    function lookupParents(blobId) { return $elf.lookupParents(blobId); }

    var ancestorBlobId = Graph.least_common_ancestor(lookupParents, b1, b2);
    var ancestorBlob = this.lookup(ancestorBlobId, false);

    var objectType = blob1.mc_version_data.objectType;
    if ((objectType != blob2.mc_version_data.objectType) ||
	(objectType != ancestorBlob.mc_version_data.objectType))
    {
	throw {message: "Object type mismatch",
	       objectTypes: [{key: b1, name: objectType},
			     {key: ancestorBlobId, name: ancestorBlob.mc_version_data.objectType},
			     {key: b2, name: blob2.mc_version_data.objectType}]};
    }

    if (b2 == ancestorBlobId) {
	return {objectType: objectType, ok: blob1, mergeBlobId: b1};
    }
    if (b1 == ancestorBlobId) {
	return {objectType: objectType, ok: blob2, mergeBlobId: b2};
    }

    var merger = Mc.TypeDirectory[objectType];
    if (!merger) {
	throw {message: "Invalid object type",
	       objectType: objectType};
    }

    var result = merger(blob1, ancestorBlob, blob2);
    if ("ok" in result) {
	result.mergeBlobId = this.store(result.ok,
					result.objectType,
					b1,
					b2).id;
    }
    return result;
};

Mc.Checkout.prototype.setDirty = function(uuid) {
    this.dirty[uuid] = true;
    this.anyDirty = true;
};

Mc.Checkout.prototype.createFile = function() {
    var uuid = this.index.insert({});
    this.setDirty(uuid);
    return uuid;
};

Mc.Checkout.prototype.deleteFile = function(uuid) {
    var result = this.index.remove(uuid);
    if (result) this.anyDirty = true;
    return result;
};

Mc.Checkout.prototype.fileExists = function(uuid) {
    return this.index.exists(uuid);
};

Mc.Checkout.prototype.hasProp = function(uuid, prop) {
    var inode = this.index.lookup(uuid);
    if (!inode) return null;
    return (inode[prop] !== undefined);
};

Mc.Checkout.prototype.getProp = function(uuid, prop, defaultValue) {
    var inode = this.index.lookup(uuid);
    if (!inode) return null;
    var v = inode[prop];
    if (v === undefined) {
	return defaultValue;
    } else {
	return Mc.Util.deepCopy(v);
    }
};

Mc.Checkout.prototype.setProp = function(uuid, prop, value) {
    var inode = this.index.lookup(uuid);
    if (!inode) return false;
    inode[prop] = value;
    this.setDirty(uuid);
    return true;
};

Mc.Checkout.prototype.clearProp = function(uuid, prop) {
    var inode = this.index.lookup(uuid);
    if (!inode) return null;
    if (inode[prop] !== undefined) {
	delete inode[prop];
	this.setDirty(uuid);
    }
    return true;
};

Mc.Checkout.prototype.forEachProp = function(uuid, f) {
    var inode = this.index.lookup(uuid);
    if (!inode) return null;
    for (var prop in inode) {
	f(prop, inode[prop]);
    }
    return true;
};

Mc.Checkout.prototype.forEachFile = function(f) {
    this.index.forEachBlob(f);
};

Mc.Checkout.prototype.clone = function() {
    var result = new Mc.Checkout(this.repo(), this.originalIndexBlobId);
    result.dirty = Mc.Util.deepCopy(this.dirty);
    result.anyDirty = this.anyDirty;
    result.index = this.index.clone();
    return result;
};

Mc.Checkout.prototype.commit = function(checkout) {
    if (!checkout.anyDirty) {
	return null;
    }

    // HERE
    throw "unimplemented";

    var newChanged = [];
    var newAlive = {};
    for (var inodeId in fs.inodes) {
        if (fs.dirty[inodeId]) {
            var newBodyId = Dvcs.Util.random_uuid();
            if (Dvcs._debugMode) { newBodyId = "body-" + newBodyId; }
            this.bodies[newBodyId] = Dvcs.Util.deepCopy(fs.inodes[inodeId]);
            newAlive[inodeId] = newBodyId;
            newChanged.push(inodeId);
        } else {
            newAlive[inodeId] = oldAlive[inodeId];
        }
    }

    var newDead = Dvcs.Util.dict_to_set(Dvcs.Util.dict_union(oldDead,
                                                             Dvcs.Util.dict_difference(oldAlive,
                                                                                       newAlive)));

    var rev = { alive: newAlive,
                dead: newDead,
                changed: newChanged,
                branch: fs.getBranch(),
                timestamp: (new Date()).getTime(),
                metadata: metadata,
                directParent: fs.directParent,
                additionalParent: fs.additionalParent };

    var newRevId = Dvcs.Util.random_uuid();
    if (Dvcs._debugMode) { newRevId = "rev-" + newRevId; }
    this.recordRevision(newRevId, rev);

    fs.directParent = newRevId;
    fs.additionalParent = null;
    fs.dirty = {};
    fs.anyDirty = false;

    return newRevId;
};
