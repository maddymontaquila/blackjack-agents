using System.Runtime.CompilerServices;

var builder = DistributedApplication.CreateBuilder(args);

var backend = builder.AddNpmApp("backend", "../src/backend", "dev")
    .WithHttpsEndpoint();

var frontend = builder.AddViteApp("frontend", "../src/frontend")
    .WithReference(backend);

backend.WithEnvironment("CORS_ORIGINS", frontend.GetEndpoint("http"));

builder.Build().Run();
