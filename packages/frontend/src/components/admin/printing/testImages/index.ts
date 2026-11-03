// Calibration images the staff can print from the "Test print" dialog. To add
// one, drop the PNG in this folder, import it with the "?url" suffix, and add
// an entry to TEST_IMAGES. width and height must match the file's IHDR chunk;
// testImages.test.ts checks that.
import bothPolaritiesUrl from "./both-polarities.png?url";
import reverseTextUrl from "./reverse-text-thresholds.png?url";
import testBadgeUrl from "./test-badge-800x2060.png?url";

export type TestImage = {
  id: string;
  name: string;
  description: string;
  url: string;
  width: number;
  height: number;
};

export const TEST_IMAGES: TestImage[] = [
  {
    id: "test-badge",
    name: "Testmönster",
    description:
      "Ram och linjaler, riktningsmarkörer, linjebreddsstege, schackrutor, fyllda ytor. 800×2060 punkter (en hel badge).",
    url: testBadgeUrl,
    width: 800,
    height: 2060,
  },
  {
    id: "reverse-text",
    name: "Vit text på svart",
    description:
      "Samma textstege tre gånger, med tröskel 128, 85 och 45. Lägre tröskel gör vit text fetare. Visar vilken som håller liten vit text läsbar. Cirka 60 % av etiketten är svart.",
    url: reverseTextUrl,
    width: 800,
    height: 2060,
  },
  {
    id: "both-polarities",
    name: "Text i båda polariteterna",
    description:
      "Vit text på svart och svart text på vit, med tröskel 85, 64 och 45. Visar vilket värde som fungerar för båda. Cirka 40 % av etiketten är svart.",
    url: bothPolaritiesUrl,
    width: 800,
    height: 2060,
  },
];
