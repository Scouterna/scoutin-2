/** @jsxImportSource @scouterna/scoutin-print-templates */

/** biome-ignore-all lint/a11y/noSvgWithoutTitle: This is only for printing */

import {
  cx,
  FitText,
  Img,
  type Label,
  QR,
} from "@scouterna/scoutin-print-templates";
import { type } from "arktype";

// Used to validate values when a job is created, and to preview. Flat, so the
// admin print form can show it as fields.
export const values = type({
  firstName: "string > 0",
  lastName: "string > 0",
  "group?": "string",
  "memberNumber?": "string",
  participantType: type(
    "'delegate' | 'participant' | 'staff' | 'volunteer' | 'office' | 'exhibitor' | 'dayVisitor'",
  ),
  "delegateNumber?": "string",
  "participantSubtype?": "string",
  "preparationGroup?": "string",
  "lunchSaturday?": "string",
  "lunchSunday?": "string",
  "dinnerSaturday?": "string",
});

// Default values in the template studio.
export const sample: typeof values.infer = {
  firstName: "Bartholomeus",
  lastName: "Abrahamsson",
  group: "Löddeköpinge Scoutkår",
  memberNumber: "3320347",
  participantType: "delegate",
  delegateNumber: "512",
  preparationGroup: "Bläckfisken – 10",
  lunchSaturday: "Hajkbanan",
  lunchSunday: "Bläckfisk",
  dinnerSaturday: "Vegetarisk gryta",
};

export const size = {
  widthMm: 100,
  lengthMm: 257.5,
};

// What each participant type prints. `meals`: whether the meal choices show.
const TYPES = {
  delegate: { label: "Ombud", meals: true },
  participant: { label: "Deltagare", meals: true },
  staff: { label: "Funktionär", meals: true },
  volunteer: { label: "Arbetsgrupp", meals: true },
  office: { label: "Anställd", meals: true },
  exhibitor: { label: "Utställare", meals: true },
  dayVisitor: { label: "Dagsdeltagare", meals: false },
} as const;

type Values = typeof values.infer;

/** The values with what the type doesn't print removed. */
export function forType(v: Values): Values {
  const delegate = v.participantType === "delegate";
  const meals = TYPES[v.participantType].meals;
  return {
    ...v,
    delegateNumber: delegate ? v.delegateNumber : undefined,
    // Beredningspatrull is for delegates only.
    preparationGroup: delegate ? v.preparationGroup : undefined,
    participantSubtype:
      v.participantType === "volunteer" ? v.participantSubtype : undefined,
    lunchSaturday: meals ? v.lunchSaturday : undefined,
    lunchSunday: meals ? v.lunchSunday : undefined,
    dinnerSaturday: meals ? v.dinnerSaturday : undefined,
  };
}

/** The type as printed: delegates also show their delegate number. */
function typeLabel(v: Values): string {
  const { label } = TYPES[v.participantType];
  return v.delegateNumber ? `${label} ${v.delegateNumber}` : label;
}

const HORIZONTAL_PADDING_MM = 5.5;

type CommonProps = {
  v: typeof values.infer;
  label: Label;
};

function LogoBar({ v, label, tw }: CommonProps & { tw?: string }) {
  const { mm } = label;
  const horizontalPadding = mm(HORIZONTAL_PADDING_MM);

  return (
    <div
      tw={cx("flex justify-between items-end bg-black", tw)}
      style={{
        paddingLeft: horizontalPadding,
        paddingRight: horizontalPadding,
        paddingTop: mm(3),
        paddingBottom: mm(3),
      }}
    >
      <Img
        src="images/scouterna_wordmark.svg"
        height={mm(4)}
        style={{
          marginTop: mm(0.5),
          marginBottom: mm(0.5),
        }}
      />
      <Img src="images/scouterna_logomark.svg" height={mm(5)} />
    </div>
  );
}

function Hero({ v, label, tw }: CommonProps & { tw?: string }) {
  const { mm, pt, width } = label;
  const horizontalPadding = mm(HORIZONTAL_PADDING_MM);
  const contentWidth = width - 2 * horizontalPadding;

  return (
    <div
      tw={cx("shrink-0 pt-30", tw)}
      style={{
        paddingLeft: horizontalPadding,
        paddingRight: horizontalPadding,
      }}
    >
      <div
        style={{
          fontSize: pt(10),
        }}
        tw="mb-8"
      >
        Demokratijamboree 2026
      </div>
      <FitText
        fontFamily="SeasonMix"
        min={pt(20)}
        max={pt(28)}
        maxLines={2}
        width={contentWidth}
        tw="mb-2"
      >
        {v.firstName} {v.lastName}
      </FitText>

      {v.group && (
        <FitText
          min={pt(8)}
          max={pt(10)}
          maxLines={2}
          width={contentWidth - mm(20)}
        >
          {v.group}
        </FitText>
      )}
    </div>
  );
}

function Front({ v, label }: CommonProps) {
  const { mm, pt, width } = label;
  const horizontalPadding = mm(HORIZONTAL_PADDING_MM);
  const contentWidth = width - 2 * horizontalPadding;

  return (
    <div tw="w-full h-1/2 flex flex-col">
      <Hero v={v} label={label} tw="h-[62%]" />

      <div tw="relative flex-1 flex flex-col bg-black text-white">
        <Img
          src="images/mountain_range.svg"
          width={width + 2}
          tw="absolute bottom-full -ml-px -mr-px -mb-px"
        />

        <div
          tw="flex justify-between"
          style={{
            paddingLeft: horizontalPadding,
            paddingRight: horizontalPadding,
          }}
        >
          <div
            style={{
              paddingTop: mm(4),
            }}
          >
            <div tw={`flex flex-col justify-center min-h-[${mm(20)}px]`}>
              <FitText
                fontFamily="Inter"
                min={pt(18)}
                max={pt(28)}
                width={contentWidth * 0.6}
              >
                {typeLabel(v)}
              </FitText>
              {v.participantSubtype && (
                <div
                  style={{
                    fontSize: pt(12),
                    marginTop: mm(1),
                  }}
                >
                  {v.participantSubtype}
                </div>
              )}
            </div>
          </div>
          <Img src="images/hand.svg" height={mm(35)} />
        </div>

        <LogoBar v={v} label={label} tw="flex-1" />
      </div>
    </div>
  );
}

function QRWithPlaceholder({
  label,
  value,
  size,
}: {
  value?: string | null;
  size: number;
  label: Label;
}) {
  const { mm, pt } = label;
  const border = 4; // border-4 is 4 dots
  const inner = size - border * 2;

  return value ? (
    <QR
      value={value}
      size={mm(21)}
      ecc="H"
      invert
      quiet={0}
      style={{
        transform: "rotate(180deg)",
        marginBottom: mm(1),
      }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        marginBottom: mm(1),
        fontSize: pt(8),
      }}
      tw="relative flex justify-center items-center border-4 border-white text-center"
    >
      <svg
        width={inner}
        height={inner}
        viewBox={`0 0 ${inner} ${inner}`}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <line
          x1={0}
          y1={0}
          x2={inner}
          y2={inner}
          stroke="white"
          strokeWidth={4}
        />
        <line
          x1={inner}
          y1={0}
          x2={0}
          y2={inner}
          stroke="white"
          strokeWidth={4}
        />
      </svg>
    </div>
  );
}

function Back({ v, label }: CommonProps) {
  const { mm, pt, width } = label;
  const meals = [
    { label: "Lördag lunch", value: v.lunchSaturday },
    { label: "Söndag lunch", value: v.lunchSunday },
    { label: "Middag", value: v.dinnerSaturday },
  ].flatMap(({ label, value }) => (value ? [{ label, value }] : []));
  const horizontalPadding = mm(HORIZONTAL_PADDING_MM);
  const contentWidth = width - 2 * horizontalPadding;

  return (
    <div
      tw="w-full h-1/2 flex flex-col"
      style={{
        transform: "rotate(180deg)",
      }}
    >
      <Hero v={v} label={label} tw="flex-1" />

      <div
        tw="flex flex-col bg-black text-white"
        style={{
          transform: "rotate(180deg)",
          paddingBottom: mm(4),
        }}
      >
        <LogoBar v={v} label={label} />

        <div
          tw="flex flex-row justify-between"
          style={{
            paddingLeft: horizontalPadding,
            paddingRight: horizontalPadding,
            paddingTop: mm(2),
          }}
        >
          <div
            tw="flex flex-col"
            style={{
              gap: mm(4),
            }}
          >
            <div>
              <div
                style={{
                  fontSize: pt(8),
                  fontWeight: 700,
                }}
              >
                Du deltar som:
              </div>
              <FitText
                fontFamily="Inter"
                min={pt(8)}
                max={pt(16)}
                width={contentWidth * 0.6}
              >
                {typeLabel(v)}
              </FitText>
            </div>

            {v.preparationGroup && (
              <div>
                <div
                  style={{
                    fontSize: pt(8),
                    fontWeight: 700,
                  }}
                >
                  Beredningspatrull:
                </div>
                <div
                  style={{
                    fontSize: pt(10),
                  }}
                >
                  {v.preparationGroup}
                </div>
              </div>
            )}

            {meals.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: pt(8),
                    fontWeight: 700,
                  }}
                >
                  Matval:
                </div>
                <div
                  tw="flex flex-col"
                  style={{ fontSize: pt(10), gap: mm(0.4) }}
                >
                  {meals.map((meal) => (
                    <div tw="flex flex-row">
                      <div style={{ width: mm(26) }}>{meal.label}:</div>
                      <div tw="flex-1">{meal.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div tw="flex items-end">
            <QRWithPlaceholder
              value={v.memberNumber}
              size={mm(21)}
              label={label}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DJ26(input: Values, label: Label) {
  const v = forType(input);
  return (
    <div
      tw="flex flex-col h-full w-full"
      style={{
        fontFamily: "Inter",
      }}
    >
      <Front v={v} label={label} />
      <Back v={v} label={label} />
    </div>
  );
}
