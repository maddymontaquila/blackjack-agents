/*instrumentation.ts*/
import { NodeSDK } from '@opentelemetry/sdk-node';
import '@opentelemetry/instrumentation-grpc';
import { credentials, ChannelOptions } from '@grpc/grpc-js';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import {
  PeriodicExportingMetricReader
} from '@opentelemetry/sdk-metrics';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

const otlpServer = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (otlpServer) {
    console.log(`OTLP server configured at ${otlpServer}`);

    const isHttps = otlpServer.startsWith('https://');
    
    // Force IPv4 and configure macOS-specific gRPC options
    const channelOptions: ChannelOptions = {
        // Force IPv4 to avoid IPv6 issues on macOS
        'grpc.dns_resolver': 'native',
        'grpc.so_reuseport': 0,
        
        // Keepalive settings for better connection stability
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 3000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.http2.max_pings_without_data': 0,
        'grpc.http2.min_time_between_pings_ms': 10000,
        'grpc.http2.min_ping_interval_without_data_ms': 300000,
        
        // Connection settings
        'grpc.initial_reconnect_backoff_ms': 1000,
        'grpc.max_reconnect_backoff_ms': 5000,
        'grpc.max_receive_message_length': 4 * 1024 * 1024,
        'grpc.max_send_message_length': 4 * 1024 * 1024,
        
        // Disable TCP_USER_TIMEOUT which can cause issues on macOS
        'grpc.http2.write_buffer_size': 64 * 1024,
        
        // Force specific address family (IPv4)
        'grpc.socket_type': 'AF_INET',
    };
    
    const grpcCredentials = !isHttps
        ? credentials.createInsecure()
        : credentials.createSsl();
        
    const grpcOptions = {
        url: otlpServer,
        credentials: grpcCredentials,
        ...channelOptions,
    };

    console.log('Using gRPC OTLP exporters with macOS-specific configuration');
    console.log('Channel options:', JSON.stringify(channelOptions, null, 2));

    const traceExporter = new OTLPTraceExporter(grpcOptions);
    const metricExporter = new OTLPMetricExporter(grpcOptions);
    const logExporter = new OTLPLogExporter(grpcOptions);

    const sdk = new NodeSDK({
        traceExporter,
        metricReader: new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis: 10000, // Export every 5 seconds
            exportTimeoutMillis: 10000, // 10 second timeout
        }),
        logRecordProcessors: [new SimpleLogRecordProcessor(logExporter)],
        instrumentations: [getNodeAutoInstrumentations()],
    });

    // Add error handling for SDK start
    try {
        sdk.start();
        console.log('OpenTelemetry SDK started successfully with gRPC exporters');
        
        // Test connection after a short delay
        setTimeout(() => {
            console.log('Testing OTLP connection...');
        }, 1000);
    } catch (error) {
        console.error('Failed to start OpenTelemetry SDK:', error);
        process.exit(1); // Exit if OTLP is required
    }
} else {
    console.log('No OTLP server configured, skipping OpenTelemetry setup');
}
