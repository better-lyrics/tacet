function isFaderInteractive(markedDisabled: boolean, modeInteractive: boolean): boolean {
  return !markedDisabled && modeInteractive;
}

function shouldCloseForDisabled(open: boolean, disabled: boolean): boolean {
  return open && disabled;
}

export { isFaderInteractive, shouldCloseForDisabled };
