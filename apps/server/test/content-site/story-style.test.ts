// story-style.test.ts's cases again, on a deployment with a content site: the documents they read reach
// them through the app's hand-off to it (content-documents.ts).
process.env["WHATBUILD_TEST_CONTENT_SITE"] = "1";
await import("../story-style.test.ts");

export {};
