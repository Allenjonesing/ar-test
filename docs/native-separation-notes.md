# Why Native Projects Must Remain Separate from the Web App

## The Short Answer

Browser AR (WebXR) and native AR (ARCore, ARKit, Niantic VPS) run in
completely different environments with incompatible build systems, SDKs,
and deployment pipelines. Mixing them in a single project would create
confusion and break both.

---

## Detailed Reasoning

### 1. Different runtimes — different build systems

| Lab              | Runtime        | Build system              | Output            |
|------------------|----------------|---------------------------|-------------------|
| `web-lab`        | Browser (JS)   | None — static files       | HTML/CSS/JS       |
| `native-unity-lab` | Unity + C#   | Unity Editor / Gradle / Xcode | APK / IPA    |
| `vps-lab`        | Unity + ARDK   | Unity Editor / Gradle / Xcode | APK / IPA    |

Placing Unity C# source files or `Assets/` folders inside a web project
would cause the Unity Editor to treat the entire repository as a project,
breaking project detection and causing erroneous import errors.

Conversely, placing HTML/JS files inside a Unity project adds unnecessary
files to the Unity import pipeline.

### 2. Different SDKs — cannot be shared

The Niantic Lightship ARDK, ARCore XR Plugin, and ARKit XR Plugin are
Unity packages installed via the Unity Package Manager. They:

- Are not available as npm or browser-compatible packages.
- Require Unity Editor to function.
- Must be configured via `ProjectSettings/` files that are Unity-specific.

Similarly, browser experiments use CDN-hosted libraries (Three.js, Leaflet.js)
that have no meaning in a Unity context.

### 3. Different deployment targets

- `web-lab` deploys to GitHub Pages (or any static host) with a `git push`.
  No build step required.
- Native labs require a full Unity build → Android Gradle build → signed APK,
  or Unity build → Xcode → signed IPA. This is a separate CI/CD pipeline that
  should not run on every web deployment.

Mixing the two would either:
- Force every web deploy to trigger a lengthy Unity build, or
- Risk accidentally deploying stale native binaries alongside web files.

### 4. Different secrets and API keys

- Native labs require: Google ARCore API key, Niantic Lightship API key,
  Apple Developer signing certificate.
- Web labs require: none (Phase 1) / backend JWT (Phase 2).

Keeping projects separate allows different secret management strategies
(e.g., Unity Cloud Build secrets vs. GitHub Actions environment secrets)
without cross-contamination.

### 5. Different version control patterns

Unity projects commit large binary files (`.unity` scenes, `.asset` files,
textures, audio, compiled plugins). These are best managed with Git LFS.

Web projects commit small text files. Applying Git LFS to web text files
is unnecessary and adds overhead.

Separate projects can have their own `.gitattributes` and Git LFS
configuration appropriate to their content.

---

## What IS Shared

Despite the separation, the projects share:

| Shared resource               | How it is shared                                |
|-------------------------------|--------------------------------------------------|
| Backend API contract          | `backend/api-contract.md` — read by all teams   |
| Entity schemas (types)        | `shared/types/*.ts` — TypeScript source of truth; mirrored manually as C# in Unity |
| Experiment metadata           | `backend/mock-data/experiments.json` and `web-lab/registry.json` |
| Design decisions & honesty    | This `docs/` folder                             |

The TypeScript interfaces in `shared/types/` are the single source of truth
for data shapes. Unity developers manually mirror these as C# classes.
A future code-generation step (e.g., NJsonSchema or a custom script) could
automate this, but it is out of scope for the current phase.

---

## Repository Layout Convention

```
ar-test/                         ← mono-repo root
├── web-lab/                     ← browser experiments (static files)
├── native-unity-lab/            ← Unity project (future, separate clone recommended)
├── vps-lab/                     ← Unity + ARDK project (future, separate clone)
├── shared/types/                ← TypeScript type definitions
├── backend/                     ← API contract + mock data
└── docs/                        ← Architecture docs (this folder)
```

`native-unity-lab/` and `vps-lab/` contain **only documentation** in this
repository. The actual Unity project files live in separate repositories
(or a separate directory outside this web project) and reference this
repository's `docs/` and `backend/` for the shared contract.

---

## Summary

| Concern                  | Reason to separate                            |
|--------------------------|-----------------------------------------------|
| Build system             | Static files vs. Unity Editor / Gradle / Xcode|
| SDK compatibility        | AR SDKs are not browser-compatible            |
| Deployment pipeline      | Web deploy vs. mobile store submission        |
| Secrets management       | Different keys, different scopes              |
| Git binary management    | Unity needs Git LFS; web does not             |
| Team workflow            | Web devs and native devs work independently   |
