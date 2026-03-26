const admin = require("firebase-admin");
try {
  let sa = require("../asaas-sa.json");
  admin.initializeApp({
    credential: admin.credential.cert(sa)
  });
} catch(e) {
  admin.initializeApp({projectId: "project-cef4991b-01a5-4cb4-bd5"});
}

async function main() {
  let r = await admin.firestore().collection("pushTokens").doc("test-token").set({ token: "test-token" });
  console.log("Done", r);
}
main();
