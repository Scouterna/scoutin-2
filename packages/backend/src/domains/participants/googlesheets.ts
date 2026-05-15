import { createSign } from "node:crypto";
import { prisma } from "../../app/prisma.ts";
import { BaseDataSource } from "../../config/baseDataSource.ts";
import { hashLookupValue } from "./data.service.ts";

export const GoogleSheetsDataSource = BaseDataSource.and({
  provider: "'googlesheets'",
  providerOptions: {
    spreadsheetId: "string",
    sheetName: "string",
    serviceAccountKey: "string",
  },
});
export type GoogleSheetsDataSource = typeof GoogleSheetsDataSource.infer;

async function getAccessToken(keyJson: string): Promise<string> {
  const key = JSON.parse(keyJson);

  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  ).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(key.private_key, "base64url");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${payload}.${sig}`,
    }),
  });

  const { access_token, error } = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (error || !access_token)
    throw new Error(`Google auth failed: ${error ?? "no access_token"}`);
  return access_token;
}

async function fetchSheetRows(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string,
): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as {
    values?: string[][];
    error?: unknown;
  };
  if (data.error)
    throw new Error(`Sheets API error: ${JSON.stringify(data.error)}`);
  return data.values ?? [];
}

export async function importGoogleSheetsData(
  dataSource: GoogleSheetsDataSource,
  dataSourceName: string,
) {
  const start = performance.now();
  console.log(
    `Starting import of Google Sheets data for data source "${dataSourceName}"...`,
  );

  const accessToken = await getAccessToken(
    dataSource.providerOptions.serviceAccountKey,
  );
  const rows = await fetchSheetRows(
    dataSource.providerOptions.spreadsheetId,
    dataSource.providerOptions.sheetName,
    accessToken,
  );

  if (rows.length < 2) {
    console.warn(
      `No data rows found in sheet "${dataSource.providerOptions.sheetName}"`,
    );
    return;
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error("Sheet has no rows");

  const col = (name: string): number => {
    const idx = headerRow.indexOf(name);
    if (idx === -1)
      throw new Error(
        `Column "${name}" not found in sheet. Headers: ${headerRow.join(", ")}`,
      );
    return idx;
  };

  const idCol = col("Medlemsnummer");
  const personnummerCol = col("Personnummer");
  const fornamnCol = col("Förnamn");
  const efternamnCol = col("Efternamn");
  const gruppCol = col("Grupp");
  const rollCol = col("Roll");

  // Collect and upsert unique groups
  const uniqueGroups = new Set(
    dataRows.map((r) => r[gruppCol]?.trim()).filter(Boolean) as string[],
  );

  await prisma.$transaction(
    [...uniqueGroups].map((name) =>
      prisma.participantGroup.upsert({
        where: {
          dataSource_idInDataSource: {
            dataSource: dataSourceName,
            idInDataSource: name,
          },
        },
        create: { dataSource: dataSourceName, idInDataSource: name, name },
        update: { name },
      }),
    ),
  );

  // Hash lookup values first (async), then build Prisma ops synchronously
  type RowData = {
    id: string;
    firstName: string;
    lastName: string;
    lookupValues: string[];
    grupp: string | null;
    roll: string | null;
  };

  const rowData = (
    await Promise.all(
      dataRows.map(async (row): Promise<RowData | null> => {
        const id = row[idCol]?.trim();
        if (!id) return null;

        const personnummer = row[personnummerCol]?.trim();
        const lookupValues = [id, personnummer].filter(Boolean).map((v) => hashLookupValue(v!));

        return {
          id,
          firstName: row[fornamnCol]?.trim() ?? "",
          lastName: row[efternamnCol]?.trim() ?? "",
          lookupValues,
          grupp: row[gruppCol]?.trim() || null,
          roll: row[rollCol]?.trim() || null,
        };
      }),
    )
  ).filter((d): d is RowData => d !== null);

  await prisma.$transaction(
    rowData.map(({ id, firstName, lastName, lookupValues, grupp, roll }) => {
      const participantGroup = grupp
        ? {
            connect: {
              dataSource_idInDataSource: {
                dataSource: dataSourceName,
                idInDataSource: grupp,
              },
            },
          }
        : undefined;

      return prisma.participant.upsert({
        where: {
          dataSource_idInDataSource: {
            dataSource: dataSourceName,
            idInDataSource: id,
          },
        },
        create: {
          dataSource: dataSourceName,
          idInDataSource: id,
          firstName,
          lastName,
          lookupValues,
          participantGroup,
          subGroup: roll,
        },
        update: {
          firstName,
          lastName,
          lookupValues,
          participantGroup,
          subGroup: roll,
        },
      });
    }),
  );

  const end = performance.now();
  console.log(
    `Finished import of Google Sheets data for data source "${dataSourceName}" in ${((end - start) / 1000).toFixed(2)} seconds.`,
  );
}
