function isFaderInteractive(markedDisabled: boolean, modeInteractive: boolean): boolean {
  return !markedDisabled && modeInteractive;
}

function shouldCloseForDisabled(open: boolean, disabled: boolean): boolean {
  return open && disabled;
}

function shouldSettleToNeutral(interactive: boolean, value: number): boolean {
  return !interactive && value !== 0;
}

export { isFaderInteractive, shouldCloseForDisabled, shouldSettleToNeutral };
