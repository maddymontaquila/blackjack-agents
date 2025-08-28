#pragma warning disable

using Aspire.Hosting.Azure;
using Azure.Provisioning.CognitiveServices;

var builder = DistributedApplication.CreateBuilder(args);

var backend = builder.AddNpmApp("backend", "../src/backend", "dev")
    .RunWithHttpsDevCertificate("HTTPS_CERT_FILE", "HTTPS_CERT_KEY_FILE", 3001)
    .WithNpmPackageInstallation();

var frontend = builder.AddViteApp("frontend", "../src/frontend")
    .WithReference(backend)
    .WithNpmPackageInstallation();

// generic aspireified auto provisioned foundry resource
var foundry = builder.AddAzureAIFoundry("foundry");

// to use the python SDK you need a foundry project specifically
var foundryProject = builder.AddParameter("foundry-project-endpoint");

var patPython = builder.AddUvApp("pat-python", "../src/pat-python", "main.py")
    .WithHttpEndpoint(targetPort: 8000, isProxied: false)
    .WithEnvironment("FOUNDRY_PROJECT_NAME", "foundry-blackjack-test-project")
    .WithReference(foundry.AddDeployment("patLLM", AIFoundryModel.OpenAI.Gpt41Mini));

backend.WithEnvironment("CORS_ORIGINS", frontend.GetEndpoint("http"));

backend.OnResourceEndpointsAllocated((r, e, ct) =>
{
    backend.WithHttpCommand(
        path: "/api/reset",
        displayName: "Reset Game Table",
        commandOptions: new()
        {
            IconName = "Delete"
        });
    return Task.CompletedTask;
});

builder.Build().Run();
