const expected = "v24.18.0";
if (process.version !== expected) {
  throw new Error(
    `Site Sourcery hosted production requires Node ${expected.slice(1)} exactly; received ${process.version}.`
  );
}
