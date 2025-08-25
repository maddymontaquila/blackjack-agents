using System.Runtime.CompilerServices;

var builder = DistributedApplication.CreateBuilder(args);

var backend = builder.AddNpmApp("backend", "../src/backend", "dev")
    .WithHttpEndpoint(targetPort: 3001, isProxied: false)
    .RunWithHttpsDevCertificate("HTTPS_CERT_FILE", "HTTPS_CERT_KEY_FILE")
    .WithNpmPackageInstallation();

var frontend = builder.AddViteApp("frontend", "../src/frontend")
    .WithReference(backend)
    .WithNpmPackageInstallation();

backend.WithEnvironment("CORS_ORIGINS", frontend.GetEndpoint("http"));

backend.WithHttpCommand(
        path: "/api/reset",
        displayName: "Reset Table",
        endpointName: "http",
        commandOptions: new HttpCommandOptions()
        {
            IconName = "Delete"
        });

builder.Build().Run();
