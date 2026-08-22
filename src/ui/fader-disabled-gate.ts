function isFaderInteractive(markedDisabled: boolean, modeInteractive: boolean): boolean {
  return !markedDisabled && modeInteractive;
}

function shouldCloseForDisabled(open: boolean, disabled: boolean): boolean {
  return open && disabled;
}

function hasSomethingToSettle(value: number): boolean {
  return value !== 0;
}

function shouldSettleToNeutral(interactive: boolean, value: number): boolean {
  return !interactive && hasSomethingToSettle(value);
}

export { hasSomethingToSettle, isFaderInteractive, shouldCloseForDisabled, shouldSettleToNeutral };
