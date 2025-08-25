/*instrumentation.ts*/
import { NodeSDK } from '@opentelemetry/sdk-node';
import '@opentelemetry/instrumentation-grpc';
import { credentials } from '@grpc/grpc-js';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import {
  PeriodicExportingMetricReader
} from '@opentelemetry/sdk-metrics';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

const otlpServer = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (otlpServer) {
    console.log(`OTLP server configured at ${otlpServer}`);

    const isHttps = otlpServer.startsWith('https://');
    const collectorOptions = {
        url: otlpServer,
        credentials: !isHttps
            ? credentials.createInsecure()
            : credentials.createSsl()
    };
    const sdk = new NodeSDK({
        traceExporter: new OTLPTraceExporter(collectorOptions),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(collectorOptions),
        }),
        logRecordProcessors: [new SimpleLogRecordProcessor(new OTLPLogExporter(collectorOptions))],
    instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();
}
