# Security policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability-reporting feature rather than a public
issue. Include the smallest redistributable reproducer, affected `padsts`
version, runtime and operating system, observed resource use, and the expected
failure mode. Do not attach confidential board files.

## Untrusted PADS files

Treat every PADS file as untrusted input. `padsts` bounds-checks native section
ranges and checked binary field reads, rejects unsupported binary versions, and
does not execute source text. Applications should still enforce file-size,
runtime, and memory limits appropriate to their service; avoid rendering
unbounded user input in a privileged process. SVG output escapes source strings,
but consumers should retain their normal SVG/content-security policy.

Lossless parsing is not the same as semantic validation. Use `padsts validate`
and strict conversion reports before fabrication or downstream conversion.
