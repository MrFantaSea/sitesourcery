const REQUIRED_NODE_VERSION = "24.18.0";

if (process.versions.node !== REQUIRED_NODE_VERSION) {
  throw new Error(
    `Site Sourcery self-host foundation requires exact Node ${REQUIRED_NODE_VERSION}; ` +
      `running ${process.versions.node}.`
  );
}

process.stdout.write(`Node runtime verified: ${REQUIRED_NODE_VERSION}\n`);
