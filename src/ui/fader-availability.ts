// -- How the fader button shows whether it may be acted on ---------------------

type FaderAvailability = "available" | "inert" | "unavailable";

interface FaderMarks {
  ariaDisabled: boolean;
  opacity: string;
  filter: string;
  cursor: string;
}

const AVAILABLE: FaderMarks = { ariaDisabled: false, opacity: "", filter: "", cursor: "" };
const INERT: FaderMarks = { ariaDisabled: true, opacity: "", filter: "", cursor: "" };
const UNAVAILABLE: FaderMarks = {
  ariaDisabled: true,
  opacity: "0.45",
  filter: "grayscale(70%)",
  cursor: "not-allowed",
};

function faderMarks(availability: FaderAvailability): FaderMarks {
  switch (availability) {
    case "inert":
      return INERT;
    case "unavailable":
      return UNAVAILABLE;
    case "available":
      return AVAILABLE;
  }
}

export { faderMarks };
export type { FaderAvailability, FaderMarks };
