const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'));
// Run tests
/*tests.integration(path.join(__dirname, ".."), {
    //            ~~~~~~~~~~~~~~~~~~~~~~~~~
    // This should be the adapter's root directory

    // If the adapter may call process.exit during startup, define here which exit codes are allowed.
    // By default, termination during startup is not allowed.
    allowedExitCodes: [11],

    // Define your own tests inside defineAdditionalTests
    // Since the tests are heavily instrumented, you need to create and use a so called "harness" to control the tests.
    defineAdditionalTests(getHarness) {
        describe("Test sendTo()", () => {
            it("Should work", () => {
                return new Promise(async (resolve) => {
                    // Create a fresh harness instance each test!
                    const harness = getHarness();
                    // Start the adapter and wait until it has started
                    await harness.startAdapterAndWait();

                    // Perform the actual test:
                    harness.sendTo("adapter.0", "test", "message", (resp) => {
                        console.dir(resp);
                        resolve();
                    });
                });
            });
        });
    },
});
*/