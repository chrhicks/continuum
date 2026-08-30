#!/usr/bin/env bun
import { runImportV1Cli } from './cli'

process.exitCode = await runImportV1Cli()
