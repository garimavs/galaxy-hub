const fs = require("fs");
const path = require("path");
const util = require("util");
const remark = require("remark");
const remarkHtml = require("remark-html");
const slugify = require("@sindresorhus/slugify");
const urlParse = require("url-parse");
const CONFIG = require("../config.json");
const TO_STRING = {}.toString;
const SUBSITES_LIST = flattenSubsites(CONFIG.subsites);

/* Using a kludge here to allow:
 * 1) importing this as a module with the `import` statement
 * 2) importing this into non-modules with the `require` function
 * 3) easily referencing these functions from other functions in the same file
 * That's the `module.exports.repr = repr` pattern.
 */

/** Template literal tag that converts all embedded values to their literal representations.
 *  Uses `util.inspect()` for the conversions.
 *  Alternatively, this can be used as a (single-argument) alias for `util.inspect`.
 *  Just call it as a regular function with one argument (E.g. `repr(obj)`).
 */
function repr(strParts, ...values) {
    if (strParts.length === undefined && values.length === 0) {
        // Being used as a util.inspect alias.
        return util.inspect(strParts);
    }
    let outParts = [];
    for (let i = 0; i < strParts.length || i < values.length; i++) {
        if (i < strParts.length) {
            outParts.push(strParts[i]);
        }
        if (i < values.length) {
            outParts.push(util.inspect(values[i]));
        }
    }
    return outParts.join("");
}
module.exports.repr = repr;

// Set operations from https://exploringjs.com/impatient-js/ch_sets.html#missing-set-operations

/** Get the union of two arrays (or any other spreadable iterable).
 *  The elements are deduplicated by `Set`, so they must work as `Set` keys.
 */
function getUnion(list1, list2) {
    let unionSet = new Set([...list1, ...list2]);
    return [...unionSet];
}
module.exports.getUnion = getUnion;

/** Get the intersection of two iterables.
 *  The elements are identified by `Set`, so they must work as `Set` keys.
 */
function getIntersection(list1, list2) {
    let set1 = new Set(list1);
    let set2 = new Set(list2);
    let interSet = new Set([...set1].filter((e) => set2.has(e)));
    return [...interSet];
}
module.exports.getIntersection = getIntersection;

function splitlines(text) {
    return text.split(/\r\n|\r|\n/);
}
module.exports.splitlines = splitlines;

function getLocale() {
    // Explicitly set locale always wins.
    if (CONFIG && CONFIG.locale) {
        return CONFIG.locale;
    }
    // This should work in all modern environments now (client- and server-side).
    if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        let dtf = Intl.DateTimeFormat();
        if (dtf.resolvedOptions) {
            let ro = dtf.resolvedOptions();
            if (ro.locale) {
                return ro.locale;
            }
        }
    }
    // Browser environments.
    // https://stackoverflow.com/questions/673905/how-to-determine-users-locale-within-browser
    if (typeof navigator !== "undefined") {
        if (navigator.languages && navigator.languages.length > 0) {
            return navigator.languages[0];
        }
        for (let prop of ["userLanguage", "browserLanguage", "systemLanguage", "language"]) {
            if (navigator[prop]) {
                return navigator[prop];
            }
        }
    }
    //TODO: process.env.LC_ALL, LC_MESSAGES, LANG, LANGUAGE (LANG worked on Linux, but strange format).
    // Fallback.
    return "en-US";
}
module.exports.getLocale = getLocale;

function getImage(imagePath, images) {
    if (!imagePath) {
        return imagePath;
    }
    if (imagePath.startsWith("/src/images/")) {
        return imagePath.substring(4);
    } else if (imagePath.startsWith("/images/")) {
        return imagePath;
    }
    let fields = imagePath.split("/");
    let filename = fields[fields.length - 1];
    let assetPath = images[filename];
    if (!assetPath) {
        console.error(repr`Image ${filename} not found in asset store.`);
        return imagePath;
    }
    return assetPath;
}
module.exports.getImage = getImage;

/** Take the value of the `subsites` key in config.json and flatten it into an array.
 * @param {Object} subsitesTree The value of the `subsites` key. Must be a tree of objects where
 *   the value for each key is another object.
 * @returns {Array} An array containing a list of all keys found in the tree.
 */
function flattenSubsites(subsitesTree) {
    let subsites = [];
    for (let [subsite, subtree] of Object.entries(subsitesTree)) {
        if (getType(subtree) !== "Object") {
            throw repr`Value in subsites config tree not an object: ${subtree}`;
        }
        subsites.push(subsite);
        let subsubsites = flattenSubsites(subtree);
        subsites = subsites.concat(subsubsites);
    }
    return subsites;
}
module.exports.flattenSubsites = flattenSubsites;

function subsiteFromPath(path) {
    let pathParts = path.split("/");
    for (let candidate of SUBSITES_LIST) {
        if (pathParts[0] === candidate || (pathParts[0] === "" && pathParts[1] === candidate)) {
            return candidate;
        }
    }
}
module.exports.subsiteFromPath = subsiteFromPath;

function getSubsiteAncestry(subsite) {
    return getTreeBranch(CONFIG.subsites, subsite);
}
module.exports.getSubsiteAncestry = getSubsiteAncestry;

/** Find the `query` in the tree and return a list containing it and its ancestors.
 * @param {Object} tree  A tree represented as an object where each key is a string and each value
 *                       is an object of the same format. Leaf nodes are keys whose values are empty
 *                       objects.
 * @param {String} query A key to search for in the tree.
 * @returns {Array} A list of keys ending with `query`, preceded by its parent, and so on, until its
 *                  top-level ancestor in the tree.
 */
function getTreeBranch(tree, query) {
    for (let [key, value] of Object.entries(tree)) {
        if (key === query) {
            return [key];
        } else {
            let result = getTreeBranch(value, query);
            if (result) {
                return [key].concat(result);
            }
        }
    }
    return false;
}
module.exports.getTreeBranch = getTreeBranch;

function mdToHtml(md) {
    //TODO: Fix links (E.g. `/src/main/index.md` -> `/main/`)
    let rawHtml;
    remark()
        .use(remarkHtml, { sanitize: false })
        .process(md, (err, file) => {
            if (err) {
                console.error(err);
            } else {
                rawHtml = String(file);
            }
        });
    return rmPrefix(rmSuffix(rawHtml.trim(), "</p>"), "<p>");
}
module.exports.mdToHtml = mdToHtml;

function gridifyPath(rawPath) {
    let decodedPath = decodeURI(rawPath);
    let rawParts = decodedPath.split("/");
    let lastPart = rawParts[rawParts.length - 1];
    if (lastPart.endsWith(".html")) {
        rawParts[rawParts.length - 1] = rmSuffix(lastPart, ".html");
        rawParts.push("");
    }
    let sluggedParts = rawParts.map(slugify);
    let fixedPath = sluggedParts.join("/");
    return ensureSuffix(fixedPath, "/");
}
module.exports.gridifyPath = gridifyPath;

/** Does the given string start with any of the given prefixes?
 * @param {String} string  String that may or may not contain the prefixes.
 * @param {Array} prefixes An array of strings - the prefixes.
 * @returns {Boolean} `true` if `string` starts with any of the given `prefixes`, `false` otherwise.
 */
function matchesPrefixes(string, prefixes) {
    for (let prefix of prefixes) {
        if (string.startsWith(prefix)) {
            return true;
        }
    }
    return false;
}
module.exports.matchesPrefixes = matchesPrefixes;

function ensurePrefix(string, prefix) {
    if (string.startsWith(prefix)) {
        return string;
    } else {
        return prefix + string;
    }
}
module.exports.ensurePrefix = ensurePrefix;

function ensureSuffix(string, suffix) {
    if (string.endsWith(suffix)) {
        return string;
    } else {
        return string + suffix;
    }
}
module.exports.ensureSuffix = ensureSuffix;

function rmPrefix(rawString, prefix) {
    if (rawString.startsWith(prefix)) {
        return rawString.slice(prefix.length);
    } else {
        return rawString;
    }
}
module.exports.rmPrefix = rmPrefix;

function rmSuffix(rawString, suffix) {
    let suffixIndex = rawString.length - suffix.length;
    if (rawString.slice(suffixIndex) === suffix) {
        return rawString.slice(0, suffixIndex);
    } else {
        return rawString;
    }
}
module.exports.rmSuffix = rmSuffix;

/** Create the same effect as adding a tab to the string, except use spaces. */
function spaceTab(rawStr, tabWidth = 8) {
    let tabStop = tabWidth * (1 + Math.floor(rawStr.length / tabWidth));
    return rawStr.padEnd(tabStop);
}
module.exports.spaceTab = spaceTab;

function rmPathPrefix(path, depth, absolute = null) {
    let inputIsAbsolute = path.startsWith("/");
    if (inputIsAbsolute) {
        depth++;
    }
    if (absolute === null) {
        absolute = inputIsAbsolute;
    }
    let fields = path.split("/");
    let newPath = fields.slice(depth).join("/");
    if (absolute) {
        return "/" + newPath;
    } else {
        return newPath;
    }
}
module.exports.rmPathPrefix = rmPathPrefix;

/**
 * Find all the children of `rootDir`.
 * Arguments:
 *   `rootDir` (`String`): An absolute or relative path of a directory.
 * Returns:
 *   `files` (`Array`): An array of paths relative to the same directory as the `rootDir`.
 *     Returns only the paths to files (tested by `isFile()`).
 */
function getFilesDeep(rootDir) {
    let files = [];
    let children = fs.readdirSync(rootDir, { withFileTypes: true });
    for (let child of children) {
        let childPath = path.join(rootDir, child.name);
        if (child.isDirectory()) {
            let descendents = getFilesDeep(childPath);
            files = files.concat(descendents);
        } else if (child.isFile()) {
            files.push(childPath);
        }
    }
    return files;
}
module.exports.getFilesDeep = getFilesDeep;

function getFilesShallow(dirPath, excludeExt = null) {
    let files = [];
    let children = fs.readdirSync(dirPath, { withFileTypes: true });
    for (let child of children) {
        //TODO: If it's a link, check that the target is a file.
        //      Looks like I'll have to use `fs.readlink()` with a callback.
        if (child.isFile() || child.isSymbolicLink()) {
            if (excludeExt === null || path.parse(child.name).ext !== excludeExt) {
                files.push(child.name);
            }
        }
    }
    return files;
}
module.exports.getFilesShallow = getFilesShallow;

/**
 * Make sure a url includes a domain name.
 * @param {String} rawUrl The input url. Currently this only handles two types of urls: (1) fully qualified ones
 *                        including a scheme and domain and (2) absolute urls (without a domain, starting with a slash).
 * @param {String} defaultDomain
 * @param {String} defaultScheme
 */
function ensureDomain(rawUrl, defaultDomain = CONFIG.host, defaultScheme = "https") {
    // Note: url-parse doesn't handle urls missing only the scheme, like google.com/path.
    // Handling these is tricky anyway, since that could also be a valid relative url.
    let url = urlParse(rawUrl, {});
    if (!url.protocol) {
        url.set("protocol", defaultScheme);
    }
    if (!url.hostname) {
        url.set("hostname", defaultDomain);
    }
    return url.href;
}
module.exports.ensureDomain = ensureDomain;

function doRedirect(destUrl, currentPath, cancelled) {
    if (cancelled) {
        console.log("Redirect cancelled.");
    } else if (currentPath === undefined || window.location.pathname === currentPath) {
        window.location.href = destUrl;
    } else {
        // Cancel redirect if the user has navigated away already.
        console.log(`Skipping redirect: user navigated away from ${currentPath}`);
    }
}
module.exports.doRedirect = doRedirect;

/** Human readable format of a date span
 * @param {Object} dayjs startDate
 * @param {Object} dayjs endDate
 */
function humanDateSpan(startDate, endDate) {
    if (startDate.year() === endDate.year()) {
        if (startDate.month() === endDate.month()) {
            // Same month
            // January 5 - 8, 2021
            return `${startDate.format("MMMM DD")} - ${endDate.format("DD")}, ${endDate.format("YYYY")}`;
        } else {
            // Same year.
            // January 5 - February 8, 2021
            return `${startDate.format("MMMM D")} - ${endDate.format("MMMM D")}, ${endDate.format("YYYY")}`;
        }
    } else {
        // January 5 2021 - February 8, 2022
        return `${startDate.format("MMMM D YYYY")} - ${endDate.format("MMMM D YYYY")}`;
    }
}
module.exports.humanDateSpan = humanDateSpan;

/** Search for an object key in an object, recursively.
 * Descend into every value whose `getType()` is "Object" or "Array".
 * @param {Object} obj       The object to search.
 * @param {String} query     The key to search for.
 * @param {Number} maxLevels The maximum number of levels to descend into the object. Default: 100.
 *   This is mainly to prevent an infinite loop in the case of a self-reference.
 * @returns The value of the key, if found. Otherwise, returns `undefined`.
 */
function findKey(obj, query, maxLevels = 100) {
    if (maxLevels <= 0) {
        return;
    }
    for (let [key, value] of Object.entries(obj)) {
        if (key === query) {
            return value;
        } else {
            if (getType(value) === "Object") {
                return findKey(value, query, maxLevels - 1);
            } else if (getType(value) === "Array") {
                for (let item of value) {
                    let result = findKey(item, query, maxLevels - 1);
                    if (getType(result) !== "Undefined") {
                        return result;
                    }
                }
            }
        }
    }
}
module.exports.findKey = findKey;

function logTree(root, depth, indent) {
    let idStr = "";
    if (root.id) {
        idStr = ` id="${root.id}`;
    }
    let classStr = "";
    if (root.className) {
        classStr = ` class="${root.className}"`;
    }
    console.log(`${indent}<${root.tagName.toLowerCase()}${idStr}${classStr}>`);
    depth -= 1;
    indent = "  " + indent;
    if (depth > 0) {
        root.children.forEach((child) => logTree(child, depth, indent));
    } else {
        console.log(`${indent}  (recursion limit)`);
    }
}
module.exports.logTree = logTree;

/** A better alternative to `typeof`.
 * Adapted from https://stackoverflow.com/questions/7390426/better-way-to-get-type-of-a-javascript-variable/7390612#7390612
 * @param {*} value  Any value, including `null` and `undefined`.
 * @returns {String} The type of value passed:
 *   undefined  "Undefined"
 *   null       "Null"
 *   1          "Number"
 *   NaN        "Number" (sorry)
 *   Infinity   "Number"
 *   false      "Boolean"
 *   'string'   "String"
 *   []         "Array"
 *   {}         "Object"
 *   isNaN      "Function"
 *   _ => {}    "Function"
 *   new Date() "Date"
 */
function getType(value) {
    let rawToString = TO_STRING.call(value);
    let fields = rawToString.split(" ");
    if (fields.length !== 2) {
        console.error(repr`Wrong number of fields in toString: ${fields}`);
        return null;
    }
    if (!fields[1].endsWith("]")) {
        console.error(repr`Unexpected toString value - no ending ']': ${rawToString}`);
        return null;
    }
    return fields[1].slice(0, fields[1].length - 1);
}
module.exports.getType = getType;
