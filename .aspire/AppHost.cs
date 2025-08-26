using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.SignalR;

var builder = DistributedApplication.CreateBuilder(args);

var backend = builder.AddNpmApp("backend", "../src/backend", "dev")
    .WithHttpEndpoint(targetPort: 3001, isProxied: false)
    .RunWithHttpsDevCertificate("HTTPS_CERT_FILE", "HTTPS_CERT_KEY_FILE")
    .WithNpmPackageInstallation();

var frontend = builder.AddViteApp("frontend", "../src/frontend")
    .WithReference(backend)
    .WithNpmPackageInstallation();

#pragma warning disable ASPIREHOSTINGPYTHON001 // Type is for evaluation purposes only and is subject to change or removal in future updates. Suppress this diagnostic to proceed.
var patPython = builder.AddUvApp("pat-python", "../src/pat-python", "main.py")
    .WithHttpEndpoint(targetPort: 8000, isProxied: false);
#pragma warning restore ASPIREHOSTINGPYTHON001 // Type is for evaluation purposes only and is subject to change or removal in future updates. Suppress this diagnostic to proceed.

backend.WithEnvironment("CORS_ORIGINS", frontend.GetEndpoint("http"));

backend.WithHttpCommand(
        path: "/api/reset",
        displayName: "Reset Game Table",
        endpointName: "http",
        commandOptions: new HttpCommandOptions()
        {
            IconName = "Delete"
        });

builder.Build().Run();
