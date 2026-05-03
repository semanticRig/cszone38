using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

[ApiController]
[Route("api/[controller]")]
public class CleanController : ControllerBase
{
    private readonly ILogger<CleanController> _logger;

    public CleanController(ILogger<CleanController> logger)
    {
        _logger = logger;
    }

    [HttpGet("{id}")]
    public IActionResult Get(int id)
    {
        _logger.LogInformation("Fetching item {ItemId}", id);
        return Ok(new { Id = id, Message = "ok" });
    }
}