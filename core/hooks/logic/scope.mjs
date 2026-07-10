// Path-scope + exception matching for the hook engine. A template can be
// restricted to a set of include globs and carve out an exception set of
// exclude globs (the em-dash rule banned everywhere EXCEPT CHANGELOG.md, the
// branch rule enforced EXCEPT on hotfix/*). A carve-out narrows a rule; it
// never disables it. Pure and dependency-free: a small glob->RegExp compiler
// (`**`, `*`, `?`, `{a,b}` alternation) so the pack needs no minimatch install.

function globToRegExpSource(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` — any number of path segments (including zero). Swallow a
        // trailing slash so `a/**/b` matches `a/b`.
        i++;
        if (glob[i + 1] === "/") i++;
        out += "(?:.*/)?";
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        out += "\\{";
      } else {
        const alts = glob.slice(i + 1, close).split(",").map((a) => a.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
        out += `(?:${alts.join("|")})`;
        i = close;
      }
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return out;
}

export function globToRegExp(glob) {
  return new RegExp("^" + globToRegExpSource(String(glob)) + "$");
}

function normalizePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchesGlob(filePath, glob) {
  const p = normalizePath(filePath);
  // A bare `*.ext` glob should match at any depth, matching common intent.
  const g = glob.includes("/") ? glob : `**/${glob}`;
  return globToRegExp(g).test(p) || globToRegExp(glob).test(p);
}

// A scope is `{ include?: string[], exclude?: string[] }`. An empty/absent
// include means "everywhere". A path in scope = matches some include AND no
// exclude. Passing no scope at all returns true (rule applies globally).
export function inScope(filePath, scope) {
  if (!scope) return true;
  const include = scope.include || [];
  const exclude = scope.exclude || [];
  const p = normalizePath(filePath);
  if (exclude.some((g) => matchesGlob(p, g))) return false;
  if (include.length === 0) return true;
  return include.some((g) => matchesGlob(p, g));
}
