import { retrieveAnchors, renderAnchorBlock } from "./src/judgeAnchorsLoader.js";
const a = retrieveAnchors("D10", "53", 1);
console.log("retrieved:", a.length, "anchors");
console.log("bands:", a.map(x => x.total + " (" + x.diplom + ")").join(", "));
console.log("---");
console.log(renderAnchorBlock(a).slice(0, 500) + "...");
