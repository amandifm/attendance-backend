import { loadDataModels } from "./src/config/face-api.js";

async function test() {
  console.log("Loading models...");
  await loadDataModels();
  console.log("Models loaded!");
}

test().catch(console.error);
