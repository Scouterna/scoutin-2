// Calibration images the staff can print from the "Test print" dialog. To add
// one, drop the PNG in this folder, import it with the "?url" suffix, and add
// an entry to TEST_IMAGES. width and height must match the file's IHDR chunk;
// testImages.test.ts checks that.
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
];
