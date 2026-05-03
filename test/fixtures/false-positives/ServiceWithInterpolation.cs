using System;
using Microsoft.Extensions.Logging;

public class ServiceWithInterpolation
{
    private readonly ILogger<ServiceWithInterpolation> _logger;

    public ServiceWithInterpolation(ILogger<ServiceWithInterpolation> logger)
    {
        _logger = logger;
    }

    public string BuildMessage(string token, string userName, int count)
    {
        var bearer = $"Bearer {token}";
        var audit = $"User {userName} executed {count} actions at {DateTime.UtcNow:o}";
        var path = $@"/users/{userName}/sessions/{count}";
        _logger.LogInformation("{Audit}", audit);
        return $"{bearer}::{path}";
    }
}