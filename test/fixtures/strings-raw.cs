using System;

public class RawStringSamples
{
    public void Run(string expr)
    {
        var token = """eyJhbGciOiJIUzI1NiJ9.payload.signature""";
        var multi = """
alpha
beta
""";
        var rawInterpolation = $$"""
Has {{expr}} inside
""";
    }
}